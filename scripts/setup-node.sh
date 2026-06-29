# Source this file to set up Node via NVM on the server.
# Usage: . "$SCRIPT_DIR/setup-node.sh"

if [ -d /srv/haminfo-cli ]; then
  export NVM_DIR="/home/ross/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1
fi
