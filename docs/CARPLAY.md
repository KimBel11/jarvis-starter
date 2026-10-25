# Jarvis in the car (CarPlay)

**What you get:** a clean voice screen on the car display: the Jarvis orb, three buttons (**Talk**, **Daily summary**, **Stop**) and your chosen background. Say what you need; your assistant answers briefly and hands real work to the right agent.

## The honest part: what you need
CarPlay is locked by Apple. A CarPlay app needs a special permission (an *entitlement*) that Apple grants per developer account:
- You need a **paid Apple Developer Program** membership (~$99/year, https://developer.apple.com/programs/).
- You must **ask Apple** for the permission and wait for approval (days to weeks). Approval is not guaranteed.
- **Without a paid account CarPlay is not possible.** That is Apple's rule, not Jarvis'.

## What to do without a paid account
Use the iPhone app (docs/IPHONE.md). Your car plays its voice through Bluetooth or the cable like any app, and you can start a voice chat before you drive. Use the Apple Watch app for quick questions.

## Step by step with a paid account
1. Install the iPhone app with the paid option first (docs/IPHONE.md, option C) and make sure it works.
2. Open https://developer.apple.com/contact/carplay/ and sign in. Fill in: your name and email, app name **Jarvis**, your bundle ID (it is `com.<your word>.jarvis`, shown in `ios-app/.install-config` after the install), category **Voice-based conversational app**.
   Description to paste: *"Jarvis is a private personal voice assistant I built for my own use. It is installed only on my own devices through development builds. In the car it shows one CarPlay voice control screen with Talk, Daily summary and Stop buttons. I speak, it answers out loud in one to three short sentences. There is no typing, browsing or video."*
3. Wait for Apple's email: *"The entitlement for CarPlay Voice Based Conversation has been assigned to your account."*
4. Go to https://developer.apple.com/account/resources/identifiers/list → your app ID → turn on **CarPlay Voice Based Conversation** → Save.
5. In the `ios-app` folder run in Terminal: `./install-iphone.command carplay`
6. Connect the iPhone to the car (cable or wireless CarPlay). Jarvis appears on the CarPlay screen. If not: iPhone Settings → General → CarPlay → your car → Customize → add Jarvis.
7. Background look: Jarvis app on the iPhone → App settings → CarPlay → Background.
