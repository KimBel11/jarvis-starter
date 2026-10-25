# Start here: set up Jarvis in about 20 minutes

Jarvis is your own command center for AI: one place to talk to an AI assistant, give work to specialist agents,
keep your projects, notes and files together, and use it from your Mac, iPhone, Apple Watch and car.
**Everything runs on your Mac and uses your own AI accounts and keys. Nothing is shared with anyone, including the person who gave you this.**

You need: a Mac (macOS 13 or newer), an internet connection, and at least one AI you can use (see step 2).
Prefer to be guided by an AI instead of reading? Open **PASTE-THIS-INTO-YOUR-AI.md** and follow it. Same result.

---
## Step 1 — Install Node.js (the engine Jarvis runs on)
1. Go to https://nodejs.org and click the big **LTS** download button. Open the file and click through the installer.
2. Check it worked: open the **Terminal** app (press ⌘ Space, type *Terminal*, Enter) and type `node -v`. You should see a number like `v22.x`.

## Step 2 — Connect at least one AI (pick what you already have)
Jarvis does not include any AI. You connect yours. Choose one or more:

| You have | Do this |
|---|---|
| **A Claude subscription** (Pro/Max) | In Terminal run `curl -fsSL https://claude.ai/install.sh | bash` then run `claude` once and sign in with your Claude account. |
| **A ChatGPT subscription** (Plus/Pro) | In Terminal run `npm install -g @openai/codex` then run `codex` once and choose "Sign in with ChatGPT". |
| **A Gemini account** | In Terminal run `npm install -g @google/gemini-cli` then run `gemini` once and sign in. |
| **Only an API key** (OpenAI, Anthropic, DeepSeek, Kimi, …) | Skip the install. After step 4 open **Vault & keys** in Jarvis and add the key (step 5). |

If any command shows an error, copy it into any AI chat and say "fix this on my Mac". You only need ONE of these to start.

## Step 3 — Put Jarvis in its place
1. Double-click the zip. You get a folder called **Jarvis Workspace**. Move it to your **Documents** folder (or anywhere you like, but not the Downloads folder).
2. Inside it you will see:
   ```
   Jarvis Workspace/
     Jarvis/            ← the app
     My First Project/  ← created for you in step 4; your own projects go here too
   ```
   Every folder in *Jarvis Workspace* whose name ends in **Project** shows up in Jarvis as a project automatically.

## Step 4 — Start Jarvis
1. Open the **Jarvis** folder and **right-click `start.command` → Open → Open** (macOS asks once because it came from the internet).
2. It asks three questions: your name, what to call your assistant, and whether Jarvis should start by itself when you log in (say yes).
3. Your browser opens at **http://localhost:4777** and says "Good to see you, <your name>". 🎉

## Step 5 — Make your AI work inside Jarvis
In Jarvis, open these pages from the left menu, in this order:
1. **System check** — shows what Jarvis found (Claude Code, Codex, Gemini, Node…). Green = ready. Red = it tells you the fix.
2. **Vault & keys** — add API keys here (they are stored encrypted on your Mac and never shown to agents). Only needed for API-key AIs, image/video services, ElevenLabs voice, etc. *You can skip it if you use Claude/Codex/Gemini sign-in.*
3. **AI Models** — see every model you connected and pick which ones your agents use.
4. At the top of Home choose who **leads**: **Claude**, **Codex**, or **Always both** (both answer; the second one reviews the first).

## Step 6 — Create your first real project
1. **Projects → ＋ New project**. Give it a name and a short description. Jarvis makes a folder with two files, `CLAUDE.md` and `AGENTS.md`. Write in them what the project is, your style, and rules agents must follow. This is how your agents learn your project.
2. Open the project → **Keys & access** to give its agents only the keys and folders they need.
3. Already have a project folder? Move it into *Jarvis Workspace* and rename it to end in **Project** (for example *Bakery Project*).

## Step 7 — Talk to your assistant
- On **Home**, type or tap the orb and say: *"Make a plan to launch my project and tell me which agent should do what."*
- Your assistant picks the right specialist, shows a **plan**, and **waits for your approval** before it changes anything. Approve with one click.
- You will get a notification only when something needs your approval, fails, or your daily summary is ready.

## Step 8 — Make it yours (everything is customizable)
- **Agent team**: edit any agent (name, role, instructions, which AI, which tools, which project) or press **＋** to build a new one.
- **Plugins & skills**: install skills that teach your agents new abilities.
- **Council**: ask a big question and several AIs answer separately and then review each other.
- **Tools & integrations**: connect **Obsidian** (notes and graph), **VS Code** (open projects), and **iMessage** (text your assistant from your iPhone).
- **Settings → Appearance**: colors, orb, background.

## Step 9 — Use it on your phone, watch and in the car
- iPhone: **docs/IPHONE.md** (no paid Apple account needed)
- Apple Watch: **docs/WATCH.md**
- CarPlay: **docs/CARPLAY.md** (needs a paid Apple Developer account; the guide explains the alternative)
- Mac app (a normal app window + menu-bar orb): **docs/MAC-APP.md**

## Something went wrong?
1. Open **System check** in Jarvis. It names the problem.
2. Still stuck? Copy the message (and the last lines of `~/Library/Logs/jarvis.log`) into your AI with: *"I'm setting up Jarvis. Here is the error. Help me fix it step by step."*
3. Restart Jarvis: close it and double-click `start.command` again.

## Updates and backups
- Your data lives only in `Jarvis/data/` and your project folders. To back up, copy `Jarvis Workspace`.
- When you receive a newer Jarvis, replace everything in the `Jarvis` folder **except `data/`**.
