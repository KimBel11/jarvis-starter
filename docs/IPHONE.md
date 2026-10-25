# Jarvis on your iPhone

Your iPhone talks to **your Mac** (where Jarvis runs). So the Mac must be on, and the iPhone needs a private connection to it. That is step 1. Then pick ONE way to get the app (A is easiest, no Apple account needed).

## Step 1 — Private connection (Tailscale, free)
1. Install **Tailscale** on the Mac (https://tailscale.com/download) and on the iPhone (App Store). Sign in with the **same** account on both.
2. In the Tailscale admin page (https://login.tailscale.com/admin/dns) make sure **MagicDNS** is on and press **Enable HTTPS**.
3. On the Mac, open Terminal and run (copy exactly):
   ```
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4777
   ```
   It prints your address, like `https://my-mac.tail1234.ts.net`. **Write it down.**
4. In Jarvis open **iPhone & remote** (left menu): choose a passphrase, add your address as the host, and turn remote access on. Nobody can use Jarvis from outside without Tailscale and that passphrase.

## Option A — Add to Home Screen (free, no Xcode, 2 minutes)
1. On the iPhone open **Safari** and go to your address from step 1. Enter your passphrase.
2. Tap **Share → Add to Home Screen → Add**. Jarvis now opens like an app, full screen, with the microphone and file upload.
   (Use Safari, not Chrome. Notifications are not available in this option.)

## Option B — The real app, built by you (free Apple ID)
Gives the native app (Face ID lock, better voice, Apple Watch app inside). It needs a Mac with **Xcode** (free, Mac App Store).
1. Install Xcode, open it once and accept the license. Then **Xcode → Settings → Accounts → +** and add your Apple ID.
2. Connect your iPhone with a cable, unlock it, tap **Trust**. On the iPhone turn on **Settings → Privacy & Security → Developer Mode** (it restarts).
3. In the `ios-app` folder double-click **`install-iphone.command`** (first time: right-click → Open). It asks for a unique word (for example your name), your server address from step 1, and builds and installs the app.
4. On the iPhone: **Settings → General → VPN & Device Management → your Apple ID → Trust**. Open Jarvis, enter your passphrase.
5. With a free Apple ID the app stops opening after **7 days**: just double-click `install-iphone.command` again.
Limits of a free Apple ID: no push notifications, no CarPlay. Everything else works.

## Option C — Paid Apple Developer account ($99/year)
Same as B, and: apps last a year, push notifications work, TestFlight sharing, CarPlay is possible (docs/CARPLAY.md).
Run `./install-iphone.command paid` in Terminal from the `ios-app` folder (it adds push notifications).

## Troubleshooting
- "Can't reach Jarvis": is the Mac awake and Jarvis running? Is Tailscale connected on both devices?
- Build fails: open `ios-app/Jarvis.xcodeproj` in Xcode, select the Jarvis target → Signing & Capabilities → choose your team, and read the red message. Paste it into your AI.
- Asked for a passphrase every time: you must use the same address you set in Jarvis → iPhone & remote.
