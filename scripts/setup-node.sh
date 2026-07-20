# Source this file to set up Node via NVM on the server.
# Usage: . "$SCRIPT_DIR/setup-node.sh"

# The `|| true` guards matter because callers run under `set -e`: without them a
# missing nvm.sh or an already-active default would abort the calling script.
if [ -d /srv/haminfo-cli ]; then
  export NVM_DIR="/home/ross/.nvm"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    \. "$NVM_DIR/nvm.sh" || true
  fi
  nvm use default >/dev/null 2>&1 || true
fi
