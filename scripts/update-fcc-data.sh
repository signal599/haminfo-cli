#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
APP_ROOT=$SCRIPT_DIR/..

cd $APP_ROOT

dist/index.js import-hd
dist/index.js import-en
dist/index.js import-am

dist/index.js update-hash
dist/index.js import-fcc-update
dist/index.js import-fcc-new
dist/index.js import-fcc-new addresses
dist/index.js delete-fcc-inactive
dist/index.js delete-fcc-inactive-addresses
dist/index.js delete-fcc-inactive-locations
dist/index.js set-po-box

dist/index.js truncate-table hd
dist/index.js truncate-table en
dist/index.js truncate-table am
