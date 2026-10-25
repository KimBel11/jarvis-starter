# Let your AI set Jarvis up for you

Copy **everything inside the grey box** below, open your AI, paste, and press Enter. Pick the version that fits you.

## Version A — you use Claude Code or Codex (best: the AI does the work on your Mac)
1. Open Terminal, then type: `cd ` (with a space), drag the **Jarvis** folder into the Terminal window, press Enter.
2. Type `claude` (or `codex`) and press Enter, then paste this:

```
You are my setup assistant. I just received "Jarvis", a personal command center for AI agents that runs on my Mac. The folder you are in is the Jarvis folder. Set it up with me.

Rules:
- Read START-HERE.md and docs/ first. Follow them; do not invent steps.
- Work step by step. Before anything that installs software, changes system settings, or touches files outside this Jarvis folder and "Jarvis Workspace", tell me what and why, and wait for my "yes".
- Never read, print or ask for my passwords or API keys. If a key is needed, tell me which Jarvis page to paste it into (Vault & keys) and let me do it myself.
- Never send anything over the internet except downloads from official sites (nodejs.org, claude.ai, openai.com, github.com, tailscale.com).
- Speak simply. Assume I am not technical.

Do this:
1. Check my Mac: macOS version, whether Node.js 18+ is installed (install the LTS from nodejs.org if not), and which AI tools I have (claude, codex, gemini).
2. Ask me what AI accounts I have (Claude, ChatGPT, Gemini, API keys) and help me install and sign in to the matching tools from START-HERE.md step 2.
3. Make sure this folder sits inside a folder called "Jarvis Workspace". Then run: node setup.js (ask me my first name and what I want to call my assistant, then run it with --name and --assistant).
4. Start Jarvis, open http://localhost:4777, and confirm that the page loads and says my name.
5. Walk me through the System check page until the AI I use shows green.
6. Help me create my first project: ask what my project is, then create the project folder in "Jarvis Workspace" (name ending in "Project") with a good CLAUDE.md and AGENTS.md based on my answers.
7. Show me how to ask my assistant to do one small real task in that project, and how to approve a plan.
8. Ask whether I want Jarvis on my iPhone, Apple Watch, in the car, or as a Mac app, and open the matching guide in docs/ and guide me through it.
Finish by telling me in 5 short lines what is set up and what to do next.
```

## Version B — you only have a chat AI (ChatGPT, Claude.ai, Gemini in the browser)
Paste this and answer its questions. It will tell you what to click and type, one step at a time.

```
Act as my patient setup guide. I am not technical. I want to set up "Jarvis", a personal command center for AI agents, on my Mac. I have a folder called Jarvis with a file START-HERE.md. I will paste its contents to you in my next message. 

How to help me:
- Give me ONE small step at a time and wait until I say "done" or paste what I see.
- Ask me first: which Mac and macOS version I have, and which AI accounts I have (Claude, ChatGPT, Gemini, or API keys).
- If I paste an error, explain it simply and give the exact fix.
- Never ask for my passwords or API keys. If something needs a key, tell me which Jarvis page (Vault & keys) to paste it into myself.
- Only recommend software from official sites. Tell me before anything that changes my system.
- When setup works (I can open http://localhost:4777 and see "Good to see you"), help me create my first project and give my first task to my assistant.
```
Then paste the text of `START-HERE.md` as your second message.

## Tip: keep using your AI as a guide later
Whenever you want to change something ("add an agent that writes my newsletter", "connect my iPhone"), tell your Jarvis assistant, or paste the relevant guide from `docs/` into any AI and ask it to walk you through.
