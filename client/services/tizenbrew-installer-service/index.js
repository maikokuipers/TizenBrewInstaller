"use strict";

const isTV = typeof tizen !== 'undefined';
// Required due to svdca.samsungqbe.com certificate expiring and Samsung not doing anything.
// Also for older Tizen TVs who had their root certificate break.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// To remove the DeprecationWarning displayed.
process.removeAllListeners('warning');

module.exports.onStart = function () {
    console.log('Service started');
    const express = require('express');
    const fetch = require('node-fetch');
    const adbhost = require('adbhost');
    const { readConfig, writeConfig } = require('./utils/configuration.js');
    const { fetchLatestRelease } = require('./utils/GitHubAPI.js')
    const { createSamsungCertificate, resignPackage } = require('./utils/SamsungCertificateCreation.js');
    const { writeFileSync, readFileSync, readdirSync, statSync, mkdirSync, existsSync } = require('fs');
    const { setValue } = require('./utils/Buxton2.js');
    const { join, dirname } = require('path');
    const { parsePackage, installPackage } = require('./utils/PackageInstallation.js');
    const { Connection, Events } = require('./utils/wsCommunication.js');
    const { homedir } = require('os');
    const { randomBytes } = require('crypto');
    const AccessInfoHTMLPage = require('./utils/HTMLPage.js');
    const PushFile = require('./utils/FilePusher.js');

    let WebSocket;
    let adbClient;
    let wsClient = null;
    let canConnectToDevice = null;
    let isConnected = false;
    if (process.version === 'v4.4.3') {
        WebSocket = require('ws-old');
    } else {
        WebSocket = require('ws-new');
    }

    const app = express();
    if (!isTV) {
        // Enable static file serving for frontend
        console.log('Open up http://localhost:8091/ui/dist/index.html to access the TizenBrew Installer.');
        // Open the setup wizard in the default browser. Set TBI_NO_BROWSER=1 to skip.
        if (!process.env.TBI_NO_BROWSER) {
            const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
            require('child_process').exec(`${opener} http://localhost:8091/ui/dist/index.html`, () => { });
        }
        if (existsSync(`${process.platform === 'win32' ? 'C:\\' : '/'}snapshot/client`)) {
            app.use(express.static(`${process.platform === 'win32' ? 'C:\\' : '/'}snapshot/client`));
        } else app.use(express.static(join(__dirname, '../../')));
    }

    app.get(['/ui/dist/index.html/desktop', '/ui/dist/index.html/advanced'], (_, res) => {
        if (existsSync(`${process.platform === 'win32' ? 'C:\\' : '/'}snapshot/client`)) {
            res.sendFile(`${process.platform === 'win32' ? 'C:\\' : '/'}snapshot/client/ui/dist/index.html`);
        } else res.sendFile((join(__dirname, '../../ui/dist/index.html')));
    });

    let isTizen7OrHigher = isTV && Number(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').split('.')[0]) >= 7;
    const isTizen3 = isTV && tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');
    const wsServer = new WebSocket.Server({ server: app.listen(8091) });

    function checkCanConnectToDevice() {
        fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
            .then(json => {
                canConnectToDevice = (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1';
            }).catch(err => {
                setTimeout(checkCanConnectToDevice, 1000);
            });
    }

    isTV && checkCanConnectToDevice();

    function createAdbConnection(ip) {
        return new Promise((resolve, reject) => {
            try {
                if (adbClient) {
                    if (adbClient._stream) {
                        adbClient._stream.removeAllListeners('connect');
                        adbClient._stream.removeAllListeners('error');
                        adbClient._stream.removeAllListeners('close');
                        // Close the previous connection: the TV accepts only one at a time.
                        adbClient._stream.on('error', () => { });
                        adbClient._stream.end();
                        adbClient._stream.destroy();
                    }
                }

                adbClient = adbhost.createConnection({ host: ip || '127.0.0.1', port: 26101 });
                let hasConnected = false;
                const waitTimeout = setTimeout(() => {
                    if (hasConnected) resolve(adbClient)
                }, 1000);

                adbClient._stream.on('connect', () => {
                    hasConnected = true;
                    isConnected = true;
                    if (isTV) {
                        clearTimeout(waitTimeout);
                        resolve(adbClient);
                    }
                });

                adbClient._stream.on('error', (e) => {
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

                adbClient._stream.on('close', () => {
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
        const parent = dirname(targetDir);
        if (!existsSync(parent)) {
            mkdirRecursive(parent);
        }
        mkdirSync(targetDir);
    }

    // Sends an event to the TV UI if it is open. Used for installs that don't come from the UI itself.
    const uiSink = {
        Event: (type, payload) => ({ type, payload }),
        send: (event) => {
            if (!wsClient) return;
            try {
                wsClient.send(event);
            } catch (e) { }
        }
    };

    // Forwards events to the UI and calls onDone with the final event of an installation.
    function createReportingSink(onDone) {
        let done = false;
        return {
            Event: uiSink.Event,
            send: (event) => {
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
        parsePackage(buffer)
            .then(pkg => {
                if (!pkg) throw new Error('No config.xml or tizen-manifest.xml found');
                conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installing'));
                if (isTV) {
                    if (!existsSync('/home/owner/share/tmp/sdk_tools')) mkdirRecursive(`/home/owner/share/tmp/sdk_tools`);
                    writeFileSync(`/home/owner/share/tmp/sdk_tools/package.${pkg.isWgt ? 'wgt' : 'tpk'}`, buffer);
                } else {
                    PushFile(adbClient, `/home/owner/share/tmp/sdk_tools/package.${pkg.isWgt ? 'wgt' : 'tpk'}`, buffer, () => {
                        installPackage(`/home/owner/share/tmp/sdk_tools/package.${pkg.isWgt ? 'wgt' : 'tpk'}`, pkg.packageId, adbClient)
                            .then(result => {
                                conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installed'));
                                conn.send(conn.Event(Events.InstallPackage, { response: 0, result }));
                            });
                    });
                    return;
                }

                if (source === 'reisxd/TizenBrewInstaller' &&
                    !isTV && existsSync(`${homedir()}/share/tizenbrewInstallerConfig.json`)) {
                    // Send the existing config to the TV
                    PushFile(adbClient, '/home/owner/share/tizenbrewInstallerConfig.json', readFileSync(`${homedir()}/share/tizenbrewInstallerConfig.json`), () => {
                        console.log('Config pushed to TV for Installer');
                    });
                }

                if (isTizen3 && isTV) {
                    const result = installPackage(`/home/owner/share/tmp/sdk_tools/package.${pkg.isWgt ? 'wgt' : 'tpk'}`, pkg.packageId);
                    setValue('db/sdk/develop/ip', 'string', '127.0.0.1');
                    setValue('db/sdk/develop/mode', 'int32', '1');
                    conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installed'));
                    conn.send(conn.Event(Events.InstallPackage, { response: 0, result: String(result) }));
                } else if (isTV) {
                    createAdbConnection()
                        .then(adbClient => {
                            installPackage(`/home/owner/share/tmp/sdk_tools/package.${pkg.isWgt ? 'wgt' : 'tpk'}`, pkg.packageId, adbClient)
                                .then(result => {
                                    conn.send(conn.Event(Events.InstallationStatus, 'installStatus.installed'));
                                    conn.send(conn.Event(Events.InstallPackage, { response: 0, result }));
                                    setTimeout(() => {
                                        adbClient._stream.end();
                                        adbClient._stream.destroy();
                                    }, 5000);
                                });
                        })
                        .catch(err => {
                            conn.send(conn.Event(Events.Error, err.message.includes('.') ? err.message : `Error creating ADB connection: ${err.message}`));
                        });
                }
            })
            .catch(err => {
                conn.send(conn.Event(Events.Error, `Error parsing package: ${err.message}`));
                console.error(err);
            });
    }

    function resignOrInstall(conn, buffer, source) {
        if (isTizen7OrHigher) {
            const config = readConfig();
            const certificates = {
                authorCert: Buffer.from(config.authorCert, 'base64').toString('binary'),
                distributorCert: Buffer.from(config.distributorCert, 'base64').toString('binary'),
                password: config.password
            };

            conn.send(conn.Event(Events.InstallationStatus, 'installStatus.resigning'));
            resignPackage(certificates, buffer)
                .then(resignedBuffer => {
                    conn.send(conn.Event(Events.InstallationStatus, 'installStatus.parsing'));
                    parseAndInstall(conn, resignedBuffer, source);
                })
                .catch(err => {
                    conn.send(conn.Event(Events.Error, `Error resigning package: ${err.message}`));
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
            const config = readConfig();
            if (!config.authorCert || !config.distributorCert || !config.password) {
                conn.send(conn.Event(Events.InstallPackage, { response: 2 }));
                return false;
            }
        }

        if (!isTV && (!adbClient || !isConnected)) {
            // Somethings wrong.
            conn.send(conn.Event(Events.ConnectToTV, { success: false }))
            return false;
        }

        return true;
    }

    // Downloads a package from a GitHub repository (user/repo) or a direct link to a .wgt/.tpk.
    function installFromUrl(conn, url) {
        conn.send(conn.Event(Events.InstallationStatus, 'installStatus.fetching'));
        if (/^https?:\/\//i.test(url)) {
            fetch(url)
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.buffer();
                })
                .then(buffer => resignOrInstall(conn, buffer, url))
                .catch(err => {
                    conn.send(conn.Event(Events.Error, `Error fetching package: ${err.message}`));
                });
            return;
        }

        fetchLatestRelease(url)
            .then(release => {
                const asset = release.assets.find(a => a.name.endsWith('.wgt') || a.name.endsWith('.tpk'));
                if (!asset) throw new Error('No .wgt or .tpk in the latest release');
                return fetch(asset.browser_download_url)
                    .then(res => res.buffer())
                    .then(buffer => resignOrInstall(conn, buffer, url))
                    .catch(err => {
                        conn.send(conn.Event(Events.Error, `Error fetching release asset: ${err.message}`));
                    });
            }).catch(err => {
                conn.send(conn.Event(Events.Error, `Error fetching GitHub release: ${err.message}`));
            });
    }

    // Enables a module in TizenBrew (same file and defaults as TizenBrew itself).
    // Also works before TizenBrew is installed: it reads the file on its first start.
    const tizenBrewConfigPath = '/home/owner/share/tizenbrewConfig.json';
    function enableTizenBrewModule(module) {
        let config = {
            modules: ['npm/@foxreis/tizentube'],
            autoLaunchServiceList: [],
            autoLaunchModule: ''
        };
        if (existsSync(tizenBrewConfigPath)) config = JSON.parse(readFileSync(tizenBrewConfigPath, 'utf8'));
        if (!config.modules) config.modules = [];
        if (config.modules.indexOf(module) === -1) config.modules.push(module);
        if (!existsSync(dirname(tizenBrewConfigPath))) mkdirRecursive(dirname(tizenBrewConfigPath));
        writeFileSync(tizenBrewConfigPath, JSON.stringify(config, null, 4));
    }

    // Pairing code for installs from another device on the network. Stays the same across restarts,
    // so a computer only has to enter it once.
    function getPairingCode() {
        const config = readConfig();
        if (!config.pairingCode) {
            config.pairingCode = ('000000' + (randomBytes(4).readUInt32BE(0) % 1000000)).slice(-6);
            writeConfig(config);
        }
        return config.pairingCode;
    }

    if (isTV) {
        let failedAttempts = 0;
        let lockedUntil = 0;
        let installBusy = false;

        app.get('/api/info', (_, res) => {
            res.json({
                app: 'TizenBrewInstaller',
                receive: 1,
                tizenVersion: tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'),
                canInstall: isTizen3 || canConnectToDevice === true
            });
        });

        app.post('/api/install', express.raw({ type: () => true, limit: '512mb' }), (req, res) => {
            if (Date.now() < lockedUntil) {
                return res.status(429).json({ ok: false, error: 'receive.tooManyAttempts' });
            }
            if (req.get('X-Pairing-Code') !== getPairingCode()) {
                failedAttempts++;
                if (failedAttempts >= 5) {
                    failedAttempts = 0;
                    lockedUntil = Date.now() + 60000;
                }
                return res.status(401).json({ ok: false, error: 'receive.wrongCode' });
            }
            failedAttempts = 0;

            if (installBusy) return res.status(409).json({ ok: false, error: 'receive.busy' });
            if (!req.body || !req.body.length) return res.status(400).json({ ok: false, error: 'receive.emptyPackage' });

            installBusy = true;
            const conn = createReportingSink(event => {
                installBusy = false;
                if (event.type === Events.InstallPackage && event.payload.response === 0) {
                    const result = String(event.payload.result || '');
                    const failedLine = result.split('\n').find(line => line.includes('install failed'));
                    if (failedLine) return res.json({ ok: false, error: 'installStatus.installFailed', line: failedLine, result });
                    return res.json({ ok: true, result });
                }
                if (event.type === Events.InstallPackage && event.payload.response === 2) {
                    return res.json({ ok: false, error: 'receive.certificateRequired' });
                }
                res.json({ ok: false, error: event.payload });
            });

            uiSink.send(uiSink.Event(Events.Received, { name: req.get('X-Package-Name') || 'package' }));
            if (!checkPrecondition(conn)) return;
            resignOrInstall(conn, req.body, 'network');
        });
    }

    if (!isTV) {
        const { networkInterfaces } = require('os');
        const net = require('net');

        // IPv4 addresses of this computer, so the setup wizard can tell which one to enter as Host PC IP.
        function localAddresses() {
            const addresses = [];
            const interfaces = networkInterfaces();
            Object.keys(interfaces).forEach(name => {
                (interfaces[name] || []).forEach(address => {
                    if (address.family === 'IPv4' && !address.internal) addresses.push(address.address);
                });
            });
            return addresses;
        }

        // Samsung TVs report their Developer mode settings on port 8001, no pairing needed.
        function readTv(ip, timeout) {
            return fetch(`http://${ip}:8001/api/v2/`, { timeout: timeout || 1500 })
                .then(res => res.json())
                .then(json => {
                    const device = json.device || {};
                    if (device.OS !== 'Tizen') return null;
                    const year = Number((device.model || '').split('_')[0]);
                    return {
                        ip,
                        name: device.name || json.name || 'Samsung TV',
                        modelName: device.modelName || '',
                        year: year ? 2000 + year : null,
                        frame: device.FrameTVSupport === 'true',
                        powerState: device.PowerState || 'unknown',
                        developerMode: device.developerMode === '1',
                        developerIP: device.developerIP || ''
                    };
                })
                .catch(() => null);
        }

        function isPortOpen(ip, port) {
            return new Promise(resolve => {
                const socket = net.connect({ host: ip, port });
                const finish = (open) => {
                    socket.destroy();
                    resolve(open);
                };
                socket.setTimeout(1500, () => finish(false));
                socket.on('connect', () => finish(true));
                socket.on('error', () => finish(false));
            });
        }

        // The address of this computer on the TV's network.
        function computerAddressFor(ip) {
            const prefix = ip.split('.').slice(0, 3).join('.');
            const addresses = localAddresses();
            return addresses.find(address => address.indexOf(prefix + '.') === 0) || addresses[0] || null;
        }

        app.get('/api/wizard/tvs', (_, res) => {
            const prefixes = [];
            localAddresses().forEach(address => {
                const prefix = address.split('.').slice(0, 3).join('.');
                if (prefixes.indexOf(prefix) === -1) prefixes.push(prefix);
            });
            const lookups = [];
            prefixes.forEach(prefix => {
                for (let i = 1; i < 255; i++) lookups.push(readTv(`${prefix}.${i}`));
            });
            Promise.all(lookups).then(tvs => {
                res.json({ tvs: tvs.filter(Boolean), computer: localAddresses() });
            });
        });

        // Releases the TV after installing: it accepts one SDB connection at a time, and TizenBrew
        // on the TV needs it once the Host PC IP is 127.0.0.1.
        app.post('/api/wizard/disconnect', (_, res) => {
            if (adbClient && adbClient._stream) {
                adbClient._stream.end();
                adbClient._stream.destroy();
            }
            adbClient = null;
            isConnected = false;
            res.json({ ok: true });
        });

        app.get('/api/wizard/tv', (req, res) => {
            const ip = String(req.query.ip || '');
            if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
            Promise.all([readTv(ip, 3000), isPortOpen(ip, 26101)]).then(([tv, sdbOpen]) => {
                res.json({ tv, sdbOpen, computer: computerAddressFor(ip), connected: !!(adbClient && isConnected) });
            });
        });
    }

    // Started as a macOS app there's no terminal to close, so quit once the browser tab has been closed for a minute.
    const quitWhenClosed = !isTV && process.execPath.indexOf('.app/Contents/MacOS/') !== -1;
    let quitTimer = null;

    wsServer.on('connection', (ws) => {
        const wsConn = new Connection(ws);
        wsClient = wsConn;
        clearTimeout(quitTimer);
        if (quitWhenClosed) {
            ws.on('close', () => {
                if (wsServer.clients.size > 0) return;
                quitTimer = setTimeout(() => process.exit(0), 60000);
            });
        }
        ws.on('message', (message) => {
            let msg;
            try {
                msg = JSON.parse(message)
            } catch (e) {
                return wsConn.send(wsConn.Event(Events.Error, `Invalid JSON: ${message}`));
            }

            const { type, payload } = msg;

            switch (type) {
                case Events.InstallPackage: {
                    if (!checkPrecondition(wsConn)) return;

                    if (/^https?:\/\//i.test(payload.url) || payload.url.split('/').length === 2) {
                        installFromUrl(wsConn, payload.url);
                    } else {
                        // USB installation
                        const fileBuffer = readFileSync(payload.url);
                        resignOrInstall(wsConn, fileBuffer, payload.url);
                    }

                    break;
                }

                case Events.NavigateDirectory: {
                    const directory = readdirSync(payload);
                    const metadata = [{
                        name: 'Go up one directory',
                        path: payload !== '/media' ? join(payload, '..') : '/media',
                        isDirectory: true
                    }];
                    for (const file of directory) {
                        const filePath = join(payload, file);
                        try {
                            const stats = statSync(filePath);
                            metadata.push({
                                name: file,
                                path: filePath,
                                isDirectory: stats.isDirectory()
                            });
                        } catch (e) { }
                    }
                    wsConn.send(wsConn.Event(Events.NavigateDirectory, metadata));
                    break;
                }
                case Events.InstallFile: {
                    if (!checkPrecondition(wsConn)) return;
                    const fileBuffer = Buffer.from(payload, 'base64');
                    resignOrInstall(wsConn, fileBuffer, 'file');
                    break;
                }
                case Events.DeleteConfiguration: {
                    const config = readConfig();
                    config.authorCert = null;
                    config.distributorCert = null;
                    config.password = null;
                    writeConfig(config);
                    wsConn.send(wsConn.Event(Events.DeleteConfiguration, null));
                    break;
                }
                case Events.EnableModule: {
                    try {
                        if (isTV) enableTizenBrewModule(payload);
                        wsConn.send(wsConn.Event(Events.EnableModule, { ok: true, module: payload }));
                    } catch (e) {
                        wsConn.send(wsConn.Event(Events.Error, `Error enabling module: ${e.message}`));
                    }
                    break;
                }
                case Events.GetPairingInfo: {
                    wsConn.send(wsConn.Event(Events.GetPairingInfo, {
                        code: isTV ? getPairingCode() : null,
                        canInstall: isTizen3 || canConnectToDevice === true
                    }));
                    break;
                }
                case Events.ConnectToTV: {
                    try {
                        createAdbConnection(payload)
                            .then(client => {
                                adbClient = client;
                                wsConn.send(wsConn.Event(Events.ConnectToTV, { success: true }));
                                const sysinfoCommand = adbClient.createStream('sysinfo:');
                                sysinfoCommand.on('data', (data) => {
                                    const INFOBUF_MAXLEN = 64;
                                    const platform_version = data.slice(INFOBUF_MAXLEN * 3, INFOBUF_MAXLEN * 4).toString().replace(/\0/g, '');
                                    isTizen7OrHigher = Number(platform_version.split('.')[0]) >= 7;
                                });
                            })
                            .catch(err => {
                                wsConn.send(wsConn.Event(Events.ConnectToTV, { success: false, error: err.message }));
                            });
                    } catch (e) {
                        wsConn.send(wsConn.Event(Events.ConnectToTV, { success: false, error: e.message }));
                    }
                    break;
                }
                default: {
                    wsConn.send(wsConn.Event(Events.Error, 'Invalid event type.'));
                    break;
                }
            }
        });
    });

    const appAccess = express();

    appAccess.use(express.urlencoded({ extended: false }));

    appAccess.use((request, response) => {
        if (request.method !== 'GET') {
            const body = JSON.parse(request.body.code);
            const accessInfo = {
                accessToken: body.access_token,
                userId: body.userId
            };

            // Randomly generate a password
            const password = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4);

            const authorInfo = {
                name: 'TizenBrew',
                email: body.inputEmailID,
                password: password,
                privilegeLevel: 'Partner'
            };

            function createCert() {
                createSamsungCertificate(authorInfo, accessInfo, adbClient, isTV)
                    .then(certificate => {
                        const currentConfig = readConfig();
                        currentConfig.authorCert = Buffer.from(certificate.authorCert, 'binary').toString('base64');
                        currentConfig.distributorCert = Buffer.from(certificate.distributorCert, 'binary').toString('base64');
                        currentConfig.password = password;
                        if (isTV) {
                            if (!existsSync('/home/owner/share/tmp/sdk_tools')) mkdirRecursive(`/home/owner/share/tmp/sdk_tools`);
                            writeFileSync('/home/owner/share/tmp/sdk_tools/device-profile.xml', certificate.distributorXML);
                        } else {
                            PushFile(adbClient, '/home/owner/share/tmp/sdk_tools/device-profile.xml', Buffer.from(certificate.distributorXML, 'utf8'), () => {
                                console.log('Device profile pushed to TV');
                            });
                        }
                        writeConfig(currentConfig);
                        if (wsClient) {
                            wsClient.send(wsClient.Event(Events.InstallPackage, { response: 1 }));
                        }
                        response.status(200).send('Certificate creation was successful. You can now close this window.');
                    })
                    .catch(err => {
                        response.status(500).json({ error: err.message });
                    });
            }

            if (isTV) {
                if (!adbClient && !isConnected) {
                    createAdbConnection().then(adbClient => {
                        createCert();
                    }).catch(err => {
                        response.status(500).json({ error: err.message });
                    });
                } else createCert();
            } else if (!adbClient || !isConnected) {
                response.send('Connection between the TV and the device was broken. Please reconnect to your TV from the previous page and try again.');
                if (wsClient) wsClient.send(wsClient.Event(Events.ConnectToTV, { success: false }))
            } else createCert();
        } else {
            response.send(AccessInfoHTMLPage);
        }
    });

    appAccess.listen(4794);
}

!isTV && module.exports.onStart();