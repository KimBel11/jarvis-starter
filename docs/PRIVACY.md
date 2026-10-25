# What is in this copy, and what is not

**Included:** the Jarvis interface and design, the server that runs on your Mac, the project, agent, skill, council, Obsidian, VS Code, iMessage and voice features, and the Mac, iPhone and Apple Watch apps and CarPlay screen as source code.

**Excluded from the current starter tree:** API keys and logins, the key vault, chats and conversation history, personal projects and files, accounts and social media connections, personal agents and skills, notification settings and devices, paths and addresses of anyone's computers.

**Your own data:**
- Everything you create is stored on your Mac in the `Jarvis/data` folder and your project folders. Nothing is uploaded to the person who shared Jarvis with you.
- Your AI traffic goes from your Mac straight to the AI provider you chose (Claude, OpenAI, Google, …) under your own account.
- Keys you add in *Vault & keys* are encrypted on your Mac. Agents are not allowed to read them.
- Jarvis listens only on your own Mac (127.0.0.1). It is reachable from your phone only through **your** Tailscale network with **your** passphrase.
- Never send your `data` folder to anyone; it contains your chats and keys.

## Publishing a starter copy

Never copy the live data directory, private project instructions, device records, logs, signed builds, or screenshots containing real workspace data. Review both file contents and Git author metadata before publishing. Removing a file from the latest commit does not erase older Git history or copies already downloaded.
