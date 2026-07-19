## Background
- The haminfo-cli project is a Node.js application which downloads amateur radio license data from the FCC, stores it in a database, performs geocoding and manages some data exports. A companion app `ham-next` provides the web front end.

## Commands
- dev: pnpm run dev <command>
- build: pnpm build

## Deployment
- The applications are deployed on a self managed virtual server from Hetzner.
- Deployment is a manual operation. `scripts/deploy.sh` is run manually from the server command line view SSH.

## Usage
- Various commands are defined in index.ts. Run with `pnpm run dev <command>` for dev or `dist/index.js <command>` in production.

## Scripts
- `scripts/download-and-update.sh` run weekly by cron.
- `scripts/geocode.sh` run hourly by cron.
- `scripts/export.sh` run every 5 minutes by cron to check for export jobs requested by ham-next users.

## Repository
- The code is on GitHub at https://github.com/signal599/haminfo-cli
