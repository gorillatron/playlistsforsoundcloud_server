
/**
 * Module dependencies.
 */

var url = require('url')
  , utils = require('./utils')
  , EventEmitter = utils.EventEmitter
  , driver = global.MONGOOSE_DRIVER_PATH || './drivers/node-mongodb-native'
  , Model = require('./model')
  , Collection  = require(driver + '/collection');

/**
 * Connection constructor. For practical reasons, a Connection equals a Db
 *
 * @param {Mongoose} mongoose base
 * @api public
 */

function Connection (base) {
  this.base = base;
  this.collections = {};
  this.models = {};
};

/**
 * Inherit from EventEmitter.
 *
 */

Connection.prototype.__proto__ = EventEmitter.prototype;

/**
 * Connection ready state:
 *  0 = Disconnected
 *  1 = Connected
 *  2 = Connecting
 *  3 = Disconnecting
 *
 * @api public
 */

Connection.prototype.readyState = 0;

/**
 * A hash of the collections associated with this connection
 *
 * @param text
 */

Connection.prototype.collections;

/**
 * The mongodb.Db instance, set when the connection is opened
 *
 * @api public
 */

Connection.prototype.db;

/**
 * Establishes the connection
 *
 * @param {String} mongodb://uri
 * @return {Connection} self
 * @api public
 */

Connection.prototype.open = function (host, database, port, callback) {
  var self = this
    , uri;

  // if we've been supplied an uri
  if (typeof database != 'string'){
    uri = url.parse(host);
    host = uri.hostname;
    port = uri.port || 27017;
    callback = database;
    database = uri.pathname.replace(/\//g, '');
  } else {
    callback = callback || port;
    port = typeof port == 'number' ? port : 27017;
  }
  
  // make sure we can open
  if (this.readyState != 0){
    if ('function' == typeof callback)
      callback(new Error('Trying to open unclosed connection'));
    return this;
  }

  // handle authentication
  if (uri && uri.auth){
    var auth = uri.auth.split(':');
    this.user = auth[0];
    this.pass = auth[1];
  } else 
    this.user = this.pass = undefined;
  
  if (!host) {
    if ('function' == typeof callback)
      callback(new Error('Please provide a valid hostname.'));
    return this;
  }

  if (!database) {
    if ('function' == typeof callback)
      callback(new Error('Please provide a database to connect to.'));
    return this;
  }

  this.name = database;
  this.host = host;
  this.port = port;

  // signal connecting
  this.readyState = 2;
  this.emit('opening');

  // open connection
  this.doOpen(function (err) {
    if (err) {
      if (typeof callback == 'function')
        callback(err);
    } else {
      self.onOpen();

      if (typeof callback == 'function')
        callback(null);
    }
  });

  return this;
};

/**
 * Connects to a replica set.
 *
 * Supply a comma-separted list of mongodb:// URIs. You only need to specify
 * the database name and/or auth to one of them.
 *
 * @param {String} comma-separated mongodb:// URIs
 * @param {Function} optional callback
 */

Connection.prototype.openSet = function (uris, database, callback) {
  var uris = uris.split(',')
    , self = this;

  if (uris.length < 2) {
    if (callback) callback(new Error('Please provide comma-separated URIs'));
    return this;
  }

  // signal connecting
  this.readyState = 2;
  this.emit('opening');

  this.host = [];
  this.port = [];

  if ('function' == typeof database)
    callback = database;
  else
    this.name = database;

  uris.forEach(function (uri) {
    var uri = url.parse(uri);

    self.host.push(uri.hostname);
    self.port.push(uri.port || 27017);

    if (!self.name && uri.pathname.replace(/\//g, ''))
      self.name = uri.pathname.replace(/\//g, '');

    if (!self.user && uri.auth) {
      var auth = uri.auth.split(':');
      self.user = auth[0];
      self.pass = auth[1];
    }
  });

  if (!this.name) {
    if (callback)
      callback(new Error('No database name provided for replica set'));
    return;
  }

  // open connection
  this.doOpenSet(function (err) {
    if (err) {
      if (typeof callback == 'function')
        callback(err);
    } else {
      self.onOpen();

      if (typeof callback == 'function')
        callback(null);
    }
  });
};

/**
 * Called when the connection is opened
 *
 * @api private
 */

Connection.prototype.onOpen = function () {
  var self = this;
  
  function open () {
    self.readyState = 1;

    // avoid having the collection subscribe to our event emitter
    // to prevent 0.3 warning
    for (var i in self.collections)
      self.collections[i].onOpen();
     
    self.emit('open');
  };
  
  // re-authenticate
  if (self.user && self.pass)
    self.db.authenticate(self.user, self.pass, open);
  else 
    open();
};

/**
 * Closes the connection
 *
 * @param {Function} optional callback
 * @return {Connection} self
 * @api public
 */

Connection.prototype.close = function (callback) {
  var self = this
    , callback = callback || function(){};

  switch (this.readyState){
    case 0: // disconnected
      callback(null);
      break;

    case 1: // connected 
      this.readyState = 3;
      this.doClose(function(err){
        if (err){
          callback(err);
        } else {
          self.onClose();
          callback(null);
        }
      });
      break;

    case 2: // connecting
      this.once('open', function(){
        self.close(callback);
      });
      break;

    case 3: // disconnecting
      this.once('close', function () {
        callback(null);
      });
      break;
  }

  return this;
};

/**
 * Called when the connection closes
 *
 * @api private
 */

Connection.prototype.onClose = function () {
  this.readyState = 0;
  
  // avoid having the collection subscribe to our event emitter
  // to prevent 0.3 warning
  for (var i in this.collections)
    this.collections[i].onClose();

  this.emit('close');
};

/**
 * Retrieves a collection, creating it if not cached.
 *
 * @param {String} collection name
 * @return {Collection} collection instance
 * @api public
 */

Connection.prototype.collection = function (name) {
  if (!(name in this.collections))
    this.collections[name] = new Collection(name, this);
  return this.collections[name];
};

/**
 * Defines a model or retrieves it
 *
 * @param {String} model name
 * @param {Schema} schema object
 * @param {String} collection name (optional, induced from model name)
 * @api public
 */

Connection.prototype.model = function (name, collection) {
  collection || (collection = utils.toCollectionName(name));
  // look up models for the collection
  if (!this.models[collection])
    this.models[collection] = {};

  if (!this.models[collection][name]){
    var model = this.base.model(name, null, collection, true)
      , Model;
    
    if (model.prototype.connection != this){
      function Model (){
        model.apply(this, arguments);
      };

      Model.__proto__ = model;
      Model.prototype.__proto__ = model.prototype;
      Model.prototype.db = this;
      Model.prototype.collection = this.collection(collection);
      Model.init();
    }

    this.models[collection][name] = Model || model;
  }
  
  return this.models[collection][name];
};

/**
 * Module exports.
 */

module.exports = Connection;
