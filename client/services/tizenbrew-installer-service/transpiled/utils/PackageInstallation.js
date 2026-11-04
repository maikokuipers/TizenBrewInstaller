"use strict";

var _require = require('child_process'),
  execSync = _require.execSync;
var xml2js = require('xml2js');
var JSZip = require('jszip');

// Only wascmd is implemented, as pkgcmd (or native apps) are not available in Tizen 3.

function installPackage(packagePath, id, adbClient) {
  if (adbClient) {
    // Install with vd_appinstall (wascmd wrapper for SDB)
    return new Promise(function (resolve, reject) {
      var stream = adbClient.createStream("shell:0 vd_appinstall ".concat(id, " ").concat(packagePath));
      var data = '';
      stream.on('data', function (chunk) {
        data += "".concat(chunk, "\n");
        if (data.indexOf('spend time') !== -1) resolve(data);
      });
      stream.on('error', function (error) {
        reject(new Error("ADB Error: ".concat(error)));
      });
      stream.on('end', function () {
        resolve(data);
      });
      stream.on('close', function () {
        resolve(data);
      });
    });
  }
  try {
    var output = execSync("wascmd -i ".concat(id, " -p ").concat(packagePath), {
      encoding: 'utf8'
    });
    return output;
  } catch (error) {
    return error;
  }
}
function parsePackage(buffer) {
  // Only WGT packages are supported, as Tizen 3 does not support native apps.
  var parser = new xml2js.Parser();
  return JSZip.loadAsync(buffer).then(function (zip) {
    var isWgt = Object.keys(zip.files).indexOf('config.xml') !== -1;
    var configXmlFile = isWgt ? zip.files['config.xml'] : zip.files['tizen-manifest.xml'];
    if (configXmlFile) {
      return configXmlFile.async('string').then(function (xmlString) {
        return parser.parseStringPromise(xmlString);
      }).then(function (result) {
        var packageId;
        if (!isWgt) {
          packageId = result.manifest.$["package"];
        } else {
          packageId = result.widget['tizen:application'][0].$["package"];
        }
        return {
          packageId: packageId,
          isWgt: isWgt
        };
      });
    } else {
      return null;
    }
  });
}
module.exports = {
  installPackage: installPackage,
  parsePackage: parsePackage
};