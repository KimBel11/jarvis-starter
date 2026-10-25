# Jarvis on your Apple Watch

Tap the orb, talk, and Jarvis answers by voice and text. **Turn the Digital Crown to set the volume.** There is a **Daily summary** button too.
The watch talks to your **iPhone**, and the iPhone talks to your Mac. So: the iPhone app must be installed (docs/IPHONE.md option B or C), Tailscale on, and the iPhone nearby.

## Install (free Apple ID is enough)
1. Install the iPhone app with `install-iphone.command` (docs/IPHONE.md, option B). The watch app is inside it.
2. Put the watch on your wrist, unlock it, keep it near the iPhone.
3. On the **watch**: Settings → Privacy & Security → **Developer Mode** → on → restart. (If you do not see it: on the Mac open Xcode → Window → Devices and Simulators, click your watch under your iPhone, wait a minute, then look again.)
4. On the **iPhone** open the **Watch** app → scroll to **Jarvis** → turn on **Show App on Apple Watch**. If it does not appear, in Xcode choose the **JarvisWatch** scheme, pick your watch as the destination and press ▶.
5. Open Jarvis on the watch, allow the microphone, tap the orb and speak.

## How it works
Watch records → sends to the iPhone → iPhone asks your assistant on your Mac → answer comes back as text and voice. If the watch says it cannot reach your iPhone, open the Jarvis app on the iPhone once.

## Limits
- Free Apple ID: the watch app also expires after 7 days; reinstall with `install-iphone.command`.
- Spoken replies are shortened; the full text is on the watch screen.
