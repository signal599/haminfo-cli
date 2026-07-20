#!/bin/bash

# Abort on the first failing command. The steps below are ordered and the later
# ones are destructive: update/delete treat the fcc_license_* tables as the
# complete set of active licenses, so letting them run after a failed import
# would delete live data from ham_station, ham_address and ham_location.
set -eo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
APP_ROOT=$SCRIPT_DIR/..

cd $APP_ROOT

. "$SCRIPT_DIR/setup-node.sh"

trap 'dist/index.js write-log "FCC download and update FAILED at line $LINENO" error || true' ERR

dist/index.js write-log 'FCC download and update started'

dist/index.js import-hd
dist/index.js import-en
dist/index.js import-am

# Gate: refuse to touch ham_station and friends unless all three imports landed
# a plausible number of rows. Exits non-zero, and set -e stops the script here.
dist/index.js check-import-counts

dist/index.js update-hash
dist/index.js import-fcc-update
dist/index.js import-fcc-new
dist/index.js import-fcc-new-addresses
dist/index.js delete-fcc-inactive
dist/index.js delete-fcc-inactive-addresses
dist/index.js delete-fcc-inactive-locations
dist/index.js set-po-box

dist/index.js truncate-table hd
dist/index.js truncate-table en
dist/index.js truncate-table am

dist/index.js revalidate-cache

dist/index.js write-log 'FCC download and update completed'
