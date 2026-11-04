"use strict";

var _require = require('child_process'),
  execSync = _require.execSync;
function getValue(valueName) {
  var cmd = execSync("buxton2ctl get system ".concat(valueName), {
    encoding: 'utf8'
  });
  var value = cmd.split(':')[1].trim();
  return value;
}
function setValue(valueName, type, value) {
  execSync("buxton2ctl set-".concat(type, " system ").concat(valueName, " ").concat(value), {
    encoding: 'utf8'
  });
}
function getDuid(adbClient, isTV) {
  return new Promise(function (resolve, reject) {
    var stream = adbClient.createStream('shell:0 getduid');
    stream.on('data', function (data) {
      var duid = data.toString().trim();
      if (adbClient._stream && isTV) {
        adbClient._stream.removeAllListeners('connect');
        adbClient._stream.removeAllListeners('error');
        adbClient._stream.removeAllListeners('close');
        adbClient._stream.end();
        adbClient._stream.destroy();
        adbClient._stream = null;
        adbClient = null;
      }
      resolve(duid);
    });
    stream.on('error', function (error) {
      reject(error);
    });
  });
}
module.exports = {
  getValue: getValue,
  setValue: setValue,
  getDuid: getDuid
};