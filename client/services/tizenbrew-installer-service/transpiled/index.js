"use strict";

function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
var isTV = typeof tizen !== 'undefined';
// Required due to svdca.samsungqbe.com certificate expiring and Samsung not doing anything.
// Also for older Tizen TVs who had their root certificate break.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// To remove the DeprecationWarning displayed.
process.removeAllListeners('warning');
module.exports.onStart = function () {
  console.log('Service started');
  var express = require('express');
  var fetch = require('node-fetch');
  var adbhost = require('adbhost');
  var _require = require('./utils/configuration.js'),
    readConfig = _require.readConfig,
    writeConfig = _require.writeConfig;
  var _require2 = require('./utils/GitHubAPI.js'),
    fetchLatestRelease = _require2.fetchLatestRelease;
  var _require3 = require('./utils/SamsungCertificateCreation.js'),
    createSamsungCertificate = _require3.createSamsungCertificate,
    resignPackage = _require3.resignPackage;
  var _require4 = require('fs'),
    writeFileSync = _require4.writeFileSync,
    readFileSync = _require4.readFileSync,
    readdirSync = _require4.readdirSync,
    statSync = _require4.statSync,
    mkdirSync = _require4.mkdirSync,
    existsSync = _require4.existsSync;
  var _require5 = require('./utils/Buxton2.js'),
    setValue = _require5.setValue;
  var _require6 = require('path'),
    join = _require6.join,
    dirname = _require6.dirname;
  var _require7 = require('./utils/PackageInstallation.js'),
    parsePackage = _require7.parsePackage,
    installPackage = _require7.installPackage;
  var _require8 = require('./utils/wsCommunication.js'),
    Connection = _require8.Connection,
    Events = _require8.Events;
  var _require9 = require('os'),
    homedir = _require9.homedir;
  var _require10 = require('crypto'),
    randomBytes = _require10.randomBytes;
  var AccessInfoHTMLPage = require('./utils/HTMLPage.js');
  var PushFile = require('./utils/FilePusher.js');
  var WebSocket;
  var adbClient;
  var wsClient = null;
  var canConnectToDevice = null;
  var isConnected = false;
  if (process.version === 'v4.4.3') {
    WebSocket = require('ws-old');
  } else {
    WebSocket = require('ws-new');
  }
  var app = express();
  if (!isTV) {
    // Enable static file serving for frontend
    console.log('Open up http://localhost:8091/ui/dist/index.html to access the TizenBrew Installer.');
    if (existsSync("".concat(process.platform === 'win32' ? 'C:\\' : '/', "snapshot/client"))) {
      app.use(express["static"]("".concat(process.platform === 'win32' ? 'C:\\' : '/', "snapshot/client")));
    } else app.use(express["static"](join(__dirname, '../../')));
  }
  app.get('/ui/dist/index.html/desktop', function (_, res) {
    if (existsSync("".concat(process.platform === 'win32' ? 'C:\\' : '/', "snapshot/client"))) {
      res.sendFile("".concat(process.platform === 'win32' ? 'C:\\' : '/', "snapshot/client/ui/dist/index.html"));
    } else res.sendFile(join(__dirname, '../../ui/dist/index.html'));
  });
  var isTizen7OrHigher = isTV && Number(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').split('.')[0]) >= 7;
  var isTizen3 = isTV && tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');
  var wsServer = new WebSocket.Server({
    server: app.listen(8091)
  });
  function checkCanConnectToDevice() {
    fetch('http://127.0.0.1:8001/api/v2/').then(function (res) {
      return res.json();
    }).then(function (json) {
      canConnectToDevice = (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1';
    })["catch"](function (err) {
      setTimeout(checkCanConnectToDevice, 1000);
    });
  }
  isTV && checkCanConnectToDevice();
  function createAdbConnection(ip) {
    return new Promise(function (resolve, reject) {
      try {
        if (adbClient) {
          if (adbClient._stream) {
            adbClient._stream.removeAllListeners('connect');
            adbClient._stream.removeAllListeners('error');
            adbClient._stream.removeAllListeners('close');
          }
        }
        adbClient = adbhost.createConnection({
          host: ip || '127.0.0.1',
          port: 26101
        });
        var hasConnected = false;
        var waitTimeout = setTimeout(function () {
          if (hasConnected) resolve(adbClient);
        }, 1000);
        adbClient._stream.on('connect', function () {
          hasConnected = true;
          isConnected = true;
          if (isTV) {
            clearTimeout(waitTimeout);
            resolve(adbClient);
          }
        });
        adbClient._stream.on('error', function (e) {
          adbClient = null;
          hasConnected = false;
          clearTimeout(waitTimeout);
          if (e.code === 'ECONNREFUSED') {
            reject(new Error('installerDesktop.sdbConnectionRefused'));
          } else if (e.code === 'ECONNRESET') {
            reject(new Error('installerDesktop.sdbConnectionReset'));
          } else {
            reject(new Error('ADB connection error: ' + e));
          }
        });
        adbClient._stream.on('close', function () {
          adbClient = null;
          isConnected = false;
          clearTimeout(waitTimeout);
          reject(new Error('ADB connection closed.'));
        });
      } catch (e) {
        reject(new Error('ADB connection error: ' + e));
      }
    });
  }
  function mkdirRecursive(targetDir) {
    if (existsSync(targetDir)) return;
    var parent = dirname(targetDir);
    if (!existsSync(parent)) {
      mkdirRecursive(parent);
    }
    mkdirSync(targetDir);
  }

  // Sends an event to the TV UI if it is open. Used for installs that don't come from the UI itself.
  var uiSink = {
    Event: function Event(type, payload) {
      return {
        type: type,
        payload: payload
      };
    },
    send: function send(event) {
      if (!wsClient) return;
      try {
        wsClient.send(event);
      } catch (e) {}
    }
  };

  // Forwards events to the UI and calls onDone with the final event of an installation.
  function createReportingSink(onDone) {
    var done = false;
    return {
      Event: uiSink.Event,
      send: function send(event) {
        uiSink.send(event);
        if (done) return;
        if (event.type === Events.Error || event.type === Events.InstallPackage || event.type === Events.ConnectToTV) {
          done = true;
          onDone(event);
        }
      }
    };
  }
  function parseAndInstall(conn, buffer, source) {
    parsePackage(buffer).then(function (pkg) {
      if (!pkg) throw new Error('No config.xml or tizen-manifest.xml found');
      conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installing'));
      if (isTV) {
        if (!existsSync('/home/owner/share/tmp/sdk_tools')) mkdirRecursive("/home/owner/share/tmp/sdk_tools");
        writeFileSync("/home/owner/share/tmp/sdk_tools/package.".concat(pkg.isWgt ? 'wgt' : 'tpk'), buffer);
      } else {
        PushFile(adbClient, "/home/owner/share/tmp/sdk_tools/package.".concat(pkg.isWgt ? 'wgt' : 'tpk'), buffer, function () {
          installPackage("/home/owner/share/tmp/sdk_tools/package.".concat(pkg.isWgt ? 'wgt' : 'tpk'), pkg.packageId, adbClient).then(function (result) {
            conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installed'));
            conn.send(conn.Event(Events.InstallPackage, {
              response: 0,
              result: result
            }));
          });
        });
        return;
      }
      if (source === 'reisxd/TizenBrewInstaller' && !isTV && existsSync("".concat(homedir(), "/share/tizenbrewInstallerConfig.json"))) {
        // Send the existing config to the TV
        PushFile(adbClient, '/home/owner/share/tizenbrewInstallerConfig.json', readFileSync("".concat(homedir(), "/share/tizenbrewInstallerConfig.json")), function () {
          console.log('Config pushed to TV for Installer');
        });
      }
      if (isTizen3 && isTV) {
        var result = installPackage("/home/owner/share/tmp/sdk_tools/package.".concat(pkg.isWgt ? 'wgt' : 'tpk'), pkg.packageId);
        setValue('db/sdk/develop/ip', 'string', '127.0.0.1');
        setValue('db/sdk/develop/mode', 'int32', '1');
        conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installed'));
        conn.send(conn.Event(Events.InstallPackage, {
          response: 0,
          result: String(result)
        }));
      } else if (isTV) {
        createAdbConnection().then(function (adbClient) {
          installPackage("/home/owner/share/tmp/sdk_tools/package.".concat(pkg.isWgt ? 'wgt' : 'tpk'), pkg.packageId, adbClient).then(function (result) {
            conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installed'));
            conn.send(conn.Event(Events.InstallPackage, {
              response: 0,
              result: result
            }));
            setTimeout(function () {
              adbClient._stream.end();
              adbClient._stream.destroy();
            }, 5000);
          });
        })["catch"](function (err) {
          conn.send(conn.Event(Events.Error, err.message.includes('.') ? err.message : "Error creating ADB connection: ".concat(err.message)));
        });
      }
    })["catch"](function (err) {
      conn.send(conn.Event(Events.Error, "Error parsing package: ".concat(err.message)));
      console.error(err);
    });
  }
  function resignOrInstall(conn, buffer, source) {
    if (isTizen7OrHigher) {
      var config = readConfig();
      var certificates = {
        authorCert: Buffer.from(config.authorCert, 'base64').toString('binary'),
        distributorCert: Buffer.from(config.distributorCert, 'base64').toString('binary'),
        password: config.password
      };
      conn.send(conn.Event(Events.InstallationStatus, 'installStatus.resigning'));
      resignPackage(certificates, buffer).then(function (resignedBuffer) {
        conn.send(conn.Event(Events.InstallationStatus, 'installStatus.parsing'));
        parseAndInstall(conn, resignedBuffer, source);
      })["catch"](function (err) {
        conn.send(conn.Event(Events.Error, "Error resigning package: ".concat(err.message)));
      });
    } else {
      conn.send(conn.Event(Events.InstallationStatus, 'installStatus.parsing'));
      parseAndInstall(conn, buffer, source);
    }
  }
  function checkPrecondition(conn) {
    if (!isTizen3 && isTV) {
      if (canConnectToDevice === null) {
        conn.send(conn.Event(Events.Error, 'errors.stillChecking'));
        return false;
      } else if (!canConnectToDevice) {
        conn.send(conn.Event(Events.Error, 'errors.debuggingNotEnabled'));
        return false;
      }
    }
    if (isTizen7OrHigher) {
      // Check if we have author and distributor certificates
      var config = readConfig();
      if (!config.authorCert || !config.distributorCert || !config.password) {
        conn.send(conn.Event(Events.InstallPackage, {
          response: 2
        }));
        return false;
      }
    }
    if (!isTV && (!adbClient || !isConnected)) {
      // Somethings wrong.
      conn.send(conn.Event(Events.ConnectToTV, {
        success: false
      }));
      return false;
    }
    return true;
  }

  // Downloads a package from a GitHub repository (user/repo) or a direct link to a .wgt/.tpk.
  function installFromUrl(conn, url) {
    conn.send(conn.Event(Events.InstallationStatus, 'installStatus.fetching'));
    if (/^https?:\/\//i.test(url)) {
      fetch(url).then(function (res) {
        if (!res.ok) throw new Error("HTTP ".concat(res.status));
        return res.buffer();
      }).then(function (buffer) {
        return resignOrInstall(conn, buffer, url);
      })["catch"](function (err) {
        conn.send(conn.Event(Events.Error, "Error fetching package: ".concat(err.message)));
      });
      return;
    }
    fetchLatestRelease(url).then(function (release) {
      var asset = release.assets.find(function (a) {
        return a.name.endsWith('.wgt') || a.name.endsWith('.tpk');
      });
      if (!asset) throw new Error('No .wgt or .tpk in the latest release');
      return fetch(asset.browser_download_url).then(function (res) {
        return res.buffer();
      }).then(function (buffer) {
        return resignOrInstall(conn, buffer, url);
      })["catch"](function (err) {
        conn.send(conn.Event(Events.Error, "Error fetching release asset: ".concat(err.message)));
      });
    })["catch"](function (err) {
      conn.send(conn.Event(Events.Error, "Error fetching GitHub release: ".concat(err.message)));
    });
  }

  // Pairing code for installs from another device on the network. Stays the same across restarts,
  // so a computer only has to enter it once.
  function getPairingCode() {
    var config = readConfig();
    if (!config.pairingCode) {
      config.pairingCode = ('000000' + randomBytes(4).readUInt32BE(0) % 1000000).slice(-6);
      writeConfig(config);
    }
    return config.pairingCode;
  }
  if (isTV) {
    var failedAttempts = 0;
    var lockedUntil = 0;
    var installBusy = false;
    app.get('/api/info', function (_, res) {
      res.json({
        app: 'TizenBrewInstaller',
        receive: 1,
        tizenVersion: tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'),
        canInstall: isTizen3 || canConnectToDevice === true
      });
    });
    app.post('/api/install', express.raw({
      type: function type() {
        return true;
      },
      limit: '512mb'
    }), function (req, res) {
      if (Date.now() < lockedUntil) {
        return res.status(429).json({
          ok: false,
          error: 'receive.tooManyAttempts'
        });
      }
      if (req.get('X-Pairing-Code') !== getPairingCode()) {
        failedAttempts++;
        if (failedAttempts >= 5) {
          failedAttempts = 0;
          lockedUntil = Date.now() + 60000;
        }
        return res.status(401).json({
          ok: false,
          error: 'receive.wrongCode'
        });
      }
      failedAttempts = 0;
      if (installBusy) return res.status(409).json({
        ok: false,
        error: 'receive.busy'
      });
      if (!req.body || !req.body.length) return res.status(400).json({
        ok: false,
        error: 'receive.emptyPackage'
      });
      installBusy = true;
      var conn = createReportingSink(function (event) {
        installBusy = false;
        if (event.type === Events.InstallPackage && event.payload.response === 0) {
          var result = String(event.payload.result || '');
          var failedLine = result.split('\n').find(function (line) {
            return line.includes('install failed');
          });
          if (failedLine) return res.json({
            ok: false,
            error: 'installStatus.installFailed',
            line: failedLine,
            result: result
          });
          return res.json({
            ok: true,
            result: result
          });
        }
        if (event.type === Events.InstallPackage && event.payload.response === 2) {
          return res.json({
            ok: false,
            error: 'receive.certificateRequired'
          });
        }
        res.json({
          ok: false,
          error: event.payload
        });
      });
      uiSink.send(uiSink.Event(Events.Received, {
        name: req.get('X-Package-Name') || 'package'
      }));
      if (!checkPrecondition(conn)) return;
      resignOrInstall(conn, req.body, 'network');
    });
  }
  wsServer.on('connection', function (ws) {
    var wsConn = new Connection(ws);
    wsClient = wsConn;
    ws.on('message', function (message) {
      var msg;
      try {
        msg = JSON.parse(message);
      } catch (e) {
        return wsConn.send(wsConn.Event(Events.Error, "Invalid JSON: ".concat(message)));
      }
      var _msg = msg,
        type = _msg.type,
        payload = _msg.payload;
      switch (type) {
        case Events.InstallPackage:
          {
            if (!checkPrecondition(wsConn)) return;
            if (/^https?:\/\//i.test(payload.url) || payload.url.split('/').length === 2) {
              installFromUrl(wsConn, payload.url);
            } else {
              // USB installation
              var fileBuffer = readFileSync(payload.url);
              resignOrInstall(wsConn, fileBuffer, payload.url);
            }
            break;
          }
        case Events.NavigateDirectory:
          {
            var directory = readdirSync(payload);
            var metadata = [{
              name: 'Go up one directory',
              path: payload !== '/media' ? join(payload, '..') : '/media',
              isDirectory: true
            }];
            var _iterator = _createForOfIteratorHelper(directory),
              _step;
            try {
              for (_iterator.s(); !(_step = _iterator.n()).done;) {
                var file = _step.value;
                var filePath = join(payload, file);
                try {
                  var stats = statSync(filePath);
                  metadata.push({
                    name: file,
                    path: filePath,
                    isDirectory: stats.isDirectory()
                  });
                } catch (e) {}
              }
            } catch (err) {
              _iterator.e(err);
            } finally {
              _iterator.f();
            }
            wsConn.send(wsConn.Event(Events.NavigateDirectory, metadata));
            break;
          }
        case Events.InstallFile:
          {
            if (!checkPrecondition(wsConn)) return;
            var _fileBuffer = Buffer.from(payload, 'base64');
            resignOrInstall(wsConn, _fileBuffer, 'file');
            break;
          }
        case Events.DeleteConfiguration:
          {
            var config = readConfig();
            config.authorCert = null;
            config.distributorCert = null;
            config.password = null;
            writeConfig(config);
            wsConn.send(wsConn.Event(Events.DeleteConfiguration, null));
            break;
          }
        case Events.GetPairingInfo:
          {
            wsConn.send(wsConn.Event(Events.GetPairingInfo, {
              code: isTV ? getPairingCode() : null,
              canInstall: isTizen3 || canConnectToDevice === true
            }));
            break;
          }
        case Events.ConnectToTV:
          {
            try {
              createAdbConnection(payload).then(function (client) {
                adbClient = client;
                wsConn.send(wsConn.Event(Events.ConnectToTV, {
                  success: true
                }));
                var sysinfoCommand = adbClient.createStream('sysinfo:');
                sysinfoCommand.on('data', function (data) {
                  var INFOBUF_MAXLEN = 64;
                  var platform_version = data.slice(INFOBUF_MAXLEN * 3, INFOBUF_MAXLEN * 4).toString().replace(/\0/g, '');
                  isTizen7OrHigher = Number(platform_version.split('.')[0]) >= 7;
                });
              })["catch"](function (err) {
                wsConn.send(wsConn.Event(Events.ConnectToTV, {
                  success: false,
                  error: err.message
                }));
              });
            } catch (e) {
              wsConn.send(wsConn.Event(Events.ConnectToTV, {
                success: false,
                error: e.message
              }));
            }
            break;
          }
        default:
          {
            wsConn.send(wsConn.Event(Events.Error, 'Invalid event type.'));
            break;
          }
      }
    });
  });
  var appAccess = express();
  appAccess.use(express.urlencoded({
    extended: false
  }));
  appAccess.use(function (request, response) {
    if (request.method !== 'GET') {
      var createCert = function createCert() {
        createSamsungCertificate(authorInfo, accessInfo, adbClient, isTV).then(function (certificate) {
          var currentConfig = readConfig();
          currentConfig.authorCert = Buffer.from(certificate.authorCert, 'binary').toString('base64');
          currentConfig.distributorCert = Buffer.from(certificate.distributorCert, 'binary').toString('base64');
          currentConfig.password = password;
          if (isTV) {
            if (!existsSync('/home/owner/share/tmp/sdk_tools')) mkdirRecursive("/home/owner/share/tmp/sdk_tools");
            writeFileSync('/home/owner/share/tmp/sdk_tools/device-profile.xml', certificate.distributorXML);
          } else {
            PushFile(adbClient, '/home/owner/share/tmp/sdk_tools/device-profile.xml', Buffer.from(certificate.distributorXML, 'utf8'), function () {
              console.log('Device profile pushed to TV');
            });
          }
          writeConfig(currentConfig);
          if (wsClient) {
            wsClient.send(wsClient.Event(Events.InstallPackage, {
              response: 1
            }));
          }
          response.status(200).send('Certificate creation was successful. You can now close this window.');
        })["catch"](function (err) {
          response.status(500).json({
            error: err.message
          });
        });
      };
      var body = JSON.parse(request.body.code);
      var accessInfo = {
        accessToken: body.access_token,
        userId: body.userId
      };

      // Randomly generate a password
      var password = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4);
      var authorInfo = {
        name: 'TizenBrew',
        email: body.inputEmailID,
        password: password,
        privilegeLevel: 'Partner'
      };
      if (isTV) {
        if (!adbClient && !isConnected) {
          createAdbConnection().then(function (adbClient) {
            createCert();
          })["catch"](function (err) {
            response.status(500).json({
              error: err.message
            });
          });
        } else createCert();
      } else if (!adbClient || !isConnected) {
        response.send('Connection between the TV and the device was broken. Please reconnect to your TV from the previous page and try again.');
        if (wsClient) wsClient.send(wsClient.Event(Events.ConnectToTV, {
          success: false
        }));
      } else createCert();
    } else {
      response.send(AccessInfoHTMLPage);
    }
  });
  appAccess.listen(4794);
};
!isTV && module.exports.onStart();