#!/usr/bin/env node
// Sends a .wgt/.tpk to TizenBrew Installer on a Samsung TV over the local network.
// The TV installs it itself, so the Host PC IP in Developer mode can stay 127.0.0.1.
//
//   node send-to-tv.mjs [tv-ip] <file.wgt | https://.../app.wgt>
//
// Open "Receive from computer" in TizenBrew Installer on the TV for its address and pairing code.
// The code is saved in ~/.config/tizenbrew-installer/tvs.json after the first successful install.
// Set TV_CODE to skip the prompt.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PORT = 8091;
const address = (ip) => ip.includes(':') ? ip : `${ip}:${PORT}`;
const CONFIG_DIR = join(homedir(), '.config', 'tizenbrew-installer');
const CONFIG_FILE = join(CONFIG_DIR, 'tvs.json');
const dutch = (process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '').startsWith('nl');

const text = dutch ? {
    usage: 'Gebruik: node send-to-tv.mjs [tv-ip] <bestand.wgt | https://.../app.wgt>',
    searching: 'Tv zoeken op het netwerk...',
    notFound: 'Geen tv met TizenBrew Installer gevonden. Open op de tv TizenBrew Installer > Ontvangen van computer, of geef het IP-adres mee.',
    found: (ips) => `Meerdere tv's gevonden: ${ips.join(', ')}. Geef het IP-adres mee.`,
    unreachable: (ip) => `Tv ${ip} reageert niet. Staat TizenBrew Installer open op de tv?`,
    cannotInstall: 'De tv kan nog niet installeren: zet in Developer mode het Host PC IP op 127.0.0.1 en herstart de tv (aan/uit-knop ingedrukt houden tot het Samsung-logo; bij een Frame zet kort drukken hem alleen in Art mode).',
    askCode: (ip) => `Koppelcode van tv ${ip} (staat op de tv onder Ontvangen van computer): `,
    downloading: (url) => `Downloaden: ${url}`,
    sending: (name, ip, size) => `${name} (${size}) naar ${ip} sturen en installeren...`,
    done: 'Geïnstalleerd.',
    failed: 'Installatie mislukt',
    errors: {
        'receive.wrongCode': 'Verkeerde koppelcode.',
        'receive.tooManyAttempts': 'Te vaak een verkeerde koppelcode. Probeer het over een minuut opnieuw.',
        'receive.busy': 'De tv is al een pakket aan het installeren.',
        'receive.emptyPackage': 'Het pakket is leeg.',
        'receive.certificateRequired': 'Deze tv (Tizen 7+) heeft eerst een Samsung-certificaat nodig. Installeer één keer iets via TizenBrew Installer op de tv om het aan te maken.',
        'errors.debuggingNotEnabled': 'Zet in Developer mode het Host PC IP op 127.0.0.1 en herstart de tv met de aan/uit-knop ingedrukt tot het Samsung-logo.',
        'errors.stillChecking': 'De tv controleert Developer mode nog. Probeer het over een paar seconden opnieuw.'
    }
} : {
    usage: 'Usage: node send-to-tv.mjs [tv-ip] <file.wgt | https://.../app.wgt>',
    searching: 'Looking for a TV on the network...',
    notFound: 'No TV with TizenBrew Installer found. On the TV, open TizenBrew Installer > Receive from computer, or pass its IP address.',
    found: (ips) => `Found several TVs: ${ips.join(', ')}. Pass the IP address.`,
    unreachable: (ip) => `TV ${ip} doesn't respond. Is TizenBrew Installer open on the TV?`,
    cannotInstall: 'The TV cannot install yet: set the Host PC IP in Developer mode to 127.0.0.1 and restart the TV (hold the power button till the Samsung logo; on a Frame TV a short press only switches to Art Mode).',
    askCode: (ip) => `Pairing code of TV ${ip} (shown on the TV under Receive from computer): `,
    downloading: (url) => `Downloading: ${url}`,
    sending: (name, ip, size) => `Sending ${name} (${size}) to ${ip} and installing...`,
    done: 'Installed.',
    failed: 'Installation failed',
    errors: {
        'receive.wrongCode': 'Wrong pairing code.',
        'receive.tooManyAttempts': 'Too many wrong pairing codes. Try again in a minute.',
        'receive.busy': 'The TV is already installing a package.',
        'receive.emptyPackage': 'The package is empty.',
        'receive.certificateRequired': 'This TV (Tizen 7+) needs a Samsung certificate first. Install something once through TizenBrew Installer on the TV to create it.',
        'errors.debuggingNotEnabled': 'Set the Host PC IP in Developer mode to 127.0.0.1 and restart the TV by holding the power button till the Samsung logo.',
        'errors.stillChecking': 'The TV is still checking Developer mode. Try again in a few seconds.'
    }
};

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function getInfo(ip, timeout = 1500) {
    try {
        const res = await fetch(`http://${address(ip)}/api/info`, { signal: AbortSignal.timeout(timeout) });
        const info = await res.json();
        return info.app === 'TizenBrewInstaller' && info.receive ? info : null;
    } catch {
        return null;
    }
}

// Tries every address in the /24 networks of this computer.
async function findTvs() {
    const prefixes = new Set();
    for (const list of Object.values(networkInterfaces())) {
        for (const net of list || []) {
            if (net.family === 'IPv4' && !net.internal) prefixes.add(net.address.split('.').slice(0, 3).join('.'));
        }
    }
    const candidates = [...prefixes].flatMap(prefix => Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`));
    const results = await Promise.all(candidates.map(async ip => (await getInfo(ip)) ? ip : null));
    return results.filter(Boolean);
}

async function readSaved() {
    try {
        return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

async function save(saved) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(saved, null, 2));
}

// One readline for the whole run, so piped input keeps working after the first question.
let rl;
async function ask(question) {
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(question);
    return answer.trim();
}

async function loadPackage(source) {
    if (/^https?:\/\//i.test(source)) {
        console.log(text.downloading(source));
        const res = await fetch(source);
        if (!res.ok) fail(`HTTP ${res.status}: ${source}`);
        return { name: basename(new URL(source).pathname) || 'package.wgt', data: Buffer.from(await res.arrayBuffer()) };
    }
    return { name: basename(source), data: await readFile(source) };
}

function formatSize(bytes) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2) fail(text.usage);
const source = args[args.length - 1];
let ip = args.length === 2 ? args[0] : process.env.TV_IP;

if (!ip) {
    console.log(text.searching);
    const tvs = await findTvs();
    if (tvs.length === 0) fail(text.notFound);
    if (tvs.length > 1) fail(text.found(tvs));
    ip = tvs[0];
}

const info = await getInfo(ip, 5000);
if (!info) fail(text.unreachable(ip));
if (!info.canInstall) fail(text.cannotInstall);

const pkg = await loadPackage(source);
const saved = await readSaved();
let code = process.env.TV_CODE || saved[ip];

for (let attempt = 0; attempt < 3; attempt++) {
    if (!code) code = await ask(text.askCode(ip));
    console.log(text.sending(pkg.name, ip, formatSize(pkg.data.length)));

    const res = await fetch(`http://${address(ip)}/api/install`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Pairing-Code': code,
            'X-Package-Name': pkg.name
        },
        body: pkg.data
    });
    const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));

    if (body.ok) {
        if (saved[ip] !== code) {
            saved[ip] = code;
            await save(saved);
        }
        console.log(text.done);
        rl?.close();
        process.exit(0);
    }

    if (body.error === 'receive.wrongCode') {
        console.error(text.errors[body.error]);
        if (saved[ip]) {
            delete saved[ip];
            await save(saved);
        }
        code = null;
        continue;
    }

    fail(`${text.failed}: ${body.line || text.errors[body.error] || body.error}${body.result ? `\n${body.result}` : ''}`);
}
fail(text.errors['receive.wrongCode']);
