#!/bin/zsh
# Double-click to start Jarvis. The first time it also runs the setup.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then echo "Node.js is missing. Install it from https://nodejs.org (the LTS button), then double-click this file again."; read -k 1; exit 1; fi
if [ ! -f data/.setup-done ]; then node setup.js; exit $?; fi
if curl -s localhost:4777/api/health >/dev/null 2>&1; then open http://localhost:4777; exit 0; fi
(sleep 1.5; open http://localhost:4777) &
exec node server.js
