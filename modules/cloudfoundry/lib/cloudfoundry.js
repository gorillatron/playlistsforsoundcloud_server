var fs = require("fs"), 
		util = require("util"), 
		path = require("path");

var exports = module.exports;

exports.version = "0.1.0";

var vcapServices = process.env.VCAP_SERVICES ? JSON.parse(process.env.VCAP_SERVICES) : {};
var defaults = {};

function loadDefaults(resource) {
	if (path.existsSync(resource)) {
		try {
			defaults = JSON.parse(fs.readFileSync(resource));		
		} catch (err) {
			throw new Error("Could not parse JSON defaults at "+path.resolve(resource));
		}
	}
};
loadDefaults("./cf-service-defaults.json");

exports.loadDefaults = loadDefaults;

/**
 * Get the configuration for a named service or a default.
 */
exports.getServiceConfig = function(name) {

	util.debug(JSON.stringify(vcapServices));

	for(type in vcapServices) {
		var svcDef = vcapServices[type];
		for(svc in svcDef) {
			if(svcDef[svc]["name"] == name) {
				return svcDef[svc].credentials;
			}
		}
	}
	
	if(defaults[name]) {
		return defaults[name] || {};
	} else {
		throw "No defaults found for '" + name + "' and not running in the cloud";
	}

};

/**
 * Returns boolean indicating whether this app is running on the cloud or not.
 */
exports.isRunningInCloud = function() {
	return (typeof process.env.VCAP_SERVICES != "undefined");
};

/**
 * Get the VCAP_APP_PORT value or a default.
 */
exports.getAppPort = function(def) {
	return (process.env.VCAP_APP_PORT || (def || 3000));
};