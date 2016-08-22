"use strict";
var BeameStore = require("../services/BeameStore");

var beameSDK = require("../../index.js");
var express = require('express');
// This require is only cause the example is inside the beame-sdk repository, you will be using require('beame-sdk');

var config = require('../../config/Config');
const module_name = config.AppModules.AtomAgent;
var BeameLogger = require('../utils/Logger');
var logger = new BeameLogger(module_name);
var PKi = {};

/** @type {String} **/
var atom_fqdn = null;

/** @type {AtomType} **/
var atomType = config.AtomType.AuthorizationServer;

var atomServices = new (require('../../src/core/AtomServices'))();
var edgeClientServices = new (require('../../src/core/EdgeClientServices'))();
var crypto = require('../../src/cli/crypto');

var allowedSign = function () {
	return atomType == config.AtomType.AuthorizationAgent || atomType == config.AtomType.AuthorizationServer;
};

var allowedAuthorize = function () {
	return atomType == config.AtomType.AuthorizationServer;
};

var buildErrorResponse = function (message) {
	return {
		"message": message
	};
};

var setAtomType = function (requiredLevel) {
	if (!atom_fqdn) return;
	try {
		if (config.AtomType[requiredLevel] != null) {
			atomServices.updateType(atom_fqdn, atomType, null);
		}
	}
	catch (e) {
		logger.info("Desired access level not provided");
	}
	atomServices.getCreds(atom_fqdn, function (error, payload) {
		if (!error) {
			try {
				atomType = payload.type;

				if(atomType!=config.AtomType[requiredLevel])
					logger.error('Failed to set required type for Atom: '+config.AtomType[requiredLevel]);

				logger.info(`Atom started with access level: allowed sign: ${allowedSign()}, allowed authorize: ${allowedAuthorize()}`);
				if (allowedAuthorize()) {
					PKi = atomServices.readPKsFile();
				}
			}
			catch (e) {
				logger.error(e.toString());
			}
		}
		else {
			logger.error(error.message);
		}
	});
};

var buildResponse = function (req, res, statusCode, data) {

	res.writeHead(statusCode, {'Content-Type': 'application/json'});

	var responseBody = {
		body: data
	};
	//noinspection ES6ModulesDependencies,NodeModulesDependencies
	res.write(JSON.stringify(responseBody));
	res.end();
};

function startAtomBeameNode(atomFqdn, requiredLevel) {

	atom_fqdn = atomFqdn;

	beameSDK.BaseHttpsServer.SampleBeameServer(atom_fqdn, null, null, function (data, app) {
		//noinspection JSUnresolvedFunction

		setAtomType(requiredLevel);

		logger.info(`Atom server started on https://${atom_fqdn} this is a publicly accessible address`);


		//noinspection JSUnusedLocalSymbols
		app.on("request", function (req, res) {

			if (req.method == 'POST') {

				req.on('data', function (data) {

					//noinspection ES6ModulesDependencies,NodeModulesDependencies
					/** @type {Object} **/
					var postData = JSON.parse(data + '');

					var method = postData["method"];

					var status = 200, response_data = {};
					logger.info(`Request:${method}`);

					switch (method) {
						case config.AtomServerRequests.GetHost:
							var isAuthorized = allowedSign();
							if (isAuthorized) {
								edgeClientServices.registerEdgeClient(atom_fqdn, function (error, payload) {
									if (!error) {
										buildResponse(req, res, status, payload, method);
										return;
									}

									status = 400;
									response_data = buildErrorResponse(error.message);

								}, true);
							}
							else {
								status = 403;
								response_data = buildErrorResponse(`Action forbidden for ${atom_fqdn}`);
							}
							break;
						case config.AtomServerRequests.AuthorizeToken:
							isAuthorized = allowedAuthorize();
							if (isAuthorized) {

								var fqdn = postData["fqdn"];

								if (!fqdn) {
									status = 400;
									response_data = buildErrorResponse(`Fqdn required for authorization`);
								}
								else {
									var token = crypto.sign(fqdn, atom_fqdn);
									if (!token) {
										status = 400;
										response_data = buildErrorResponse(`Sign failed`);
									}
									else {
										response_data = {"token": token};
									}
								}
							}
							else {
								status = 403;
								response_data = buildErrorResponse(`Action forbidden for ${atom_fqdn}`);
							}
							break;
						case config.AtomServerRequests.SignAuthToken:
							isAuthorized = allowedSign();
							if (isAuthorized) {
								var authToken = postData["authToken"];
								fqdn = postData["fqdn"];
								var authServer = postData["authServer"];
								if (!authToken) {
									status = 400;
									response_data = buildErrorResponse(`Auth Token required`);
								}
								else {
									try {
										var PK = PKi[authServer];
										if (crypto.checkSignatureWithPK(fqdn, PK, authToken)) {
											token = crypto.sign(fqdn, atom_fqdn);
											if (!token) {
												status = 400;
												response_data = buildErrorResponse(`Sign failed`);
											}
											else {
												response_data = {"authToken": token};
											}
										}
										else {
											response_data = buildErrorResponse(`Signature verification failed`);
										}
									}
									catch (e) {
										response_data = buildErrorResponse(`Sign failed - no PK`);
									}
								}
							}
							else {
								status = 403;
								response_data = buildErrorResponse(`Action forbidden for ${atom_fqdn}`);
							}
							break;
						default:
							status = 400;
							response_data = buildErrorResponse("Unknown request type");
							break;
					}

					if (Object.keys(response_data).length > 0)
						buildResponse(req, res, status, response_data, method);
				});
			}
		});

	});
}


module.exports = {
	startAtomBeameNode
};
