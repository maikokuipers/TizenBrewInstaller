# TizenBrew Installer

TizenBrew Installer allows you to install TizenBrew and other Tizen apps easily, with resigning support for Tizen 7+ TVs!

[Discord Server Invite](https://discord.gg/m2P7v8Y2qR)

## Installation

To install TizenBrew Installer, you'll need a PC or a mobile device. Since Samsung has shut down the service for the USB Demo Package creation, the only way is using TizenBrew Installer Desktop.

## Setup wizard (first install)

Download TizenBrew Installer for your computer from the [releases](https://github.com/maikokuipers/TizenBrewInstaller/releases/latest)
and open it. On a Mac, unzip `TizenBrewInstaller-macos-arm64.zip` (Apple silicon) or `-x64.zip` (Intel) and open
`TizenBrew Installer.app` with right-click > Open the first time. It quits by itself a minute after you close the browser tab. A setup wizard opens in your browser and walks you through it:

1. **Choose TV**: finds the Samsung TVs on your network.
2. **Developer mode**: shows what to enter on the TV and checks the TV's settings live.
3. **Restart**: waits until the TV accepts this computer (with the Frame TV Art Mode pitfall explained).
4. **Install**: TizenBrew Installer, TizenBrew with TizenTube and Streamy. Tizen 7+ TVs sign in to a Samsung account once.
5. **Finish**: set the Host PC IP back to `127.0.0.1`. From then on you install everything from the TV.

The old screen is still at http://localhost:8091/ui/dist/index.html/advanced.

## Install from your computer without changing the Host PC IP

TizenBrew needs the Host PC IP in Developer mode set to `127.0.0.1`. Normally you have to change it to your
computer's IP to install your own apps, and back again afterwards. With "Receive from computer" that's no
longer needed: the TV installs the package itself.

1. Open TizenBrew Installer on the TV and choose **Receive from computer**. It shows the TV's address and a
   pairing code.
2. On your computer (Node.js 18+), run:

   ```
   node cli/send-to-tv.mjs [tv-ip] path/to/app.wgt
   ```

   Without an IP the script searches the local network. It asks for the pairing code once and saves it in
   `~/.config/tizenbrew-installer/tvs.json`. You can also pass a link: `node cli/send-to-tv.mjs https://example.com/app.wgt`.

## TizenBrew Installer Desktop

TizenBrew Installer Desktop is TizenBrew Installer on your PC or (Android only) mobile device. Download the latest release from the [releases section](https://github.com/reisxd/TizenBrewInstaller/releases/latest).

### Using TizenBrew Installer Desktop manually

If you're using Termux or would like to use TizenBrew Installer Desktop manually, you can follow these steps:

1. Install [Node.js](https://nodejs.org/) (on Android, you can use [Termux](https://termux.com/) and install Node.js via `pkg install nodejs`).

2. Install [git](https://git-scm.com/) if you don't have it already (on Android/Termux, use `pkg install git`).

3. Clone the repository using `git clone https://github.com/reisxd/TizenBrewInstaller.git`.

4. Navigate to the `ui` folder using `cd TizenBrewInstaller/client/ui` and run `npm install --force && npm run build`.

5. Navigate to the `tizenbrew-installer-service` folder using `cd ../services/tizenbrew-installer-service` and run `npm install`.

6. Run the application using `node .`.
