"use strict";

var _require = require('fs'),
  existsSync = _require.existsSync,
  readFileSync = _require.readFileSync,
  writeFileSync = _require.writeFileSync,
  mkdirSync = _require.mkdirSync;
var _require2 = require('os'),
  homedir = _require2.homedir;
function readConfig() {
  if (!existsSync("".concat(homedir(), "/share/tizenbrewInstallerConfig.json"))) {
    return {
      authorCert: null,
      distributorCert: null,
      password: null
    };
  }
  return JSON.parse(readFileSync("".concat(homedir(), "/share/tizenbrewInstallerConfig.json"), 'utf8'));
}
function writeConfig(config) {
  if (!existsSync("".concat(homedir(), "/share"))) {
    mkdirSync("".concat(homedir(), "/share"));
  }
  writeFileSync("".concat(homedir(), "/share/tizenbrewInstallerConfig.json"), JSON.stringify(config, null, 4));
}
module.exports = {
  readConfig: readConfig,
  writeConfig: writeConfig
};