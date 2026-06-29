## Background
- The haminfo-cli project is a Node.js rewrite of the back end part of the `haminfo` `Amateur Radio License Map` Drupal project seen here https://github.com/signal599/haminfo and locally at ~/projects/haminfo. It imports data weekly from the FCC and performs geocoding on newly imported data.
- `ham-next` https://github.com/signal599/ham-next or ~/projects/ham-next is a companion Next.js application which is the front end public web site.
- The database is the old Drupal MySQL database. The tables accessed by ham-next and haminfo-cli are the only tables still in use. They are fcc_license_am, fcc_license_en, fcc_license_hd, ham_address, ham_location and ham_station, ham_station_export. Other Drupal tables will eventually be dropped.

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
