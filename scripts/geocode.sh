#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
APP_ROOT=$SCRIPT_DIR/..

cd $APP_ROOT

. "$SCRIPT_DIR/setup-node.sh"

dist/index.js geocode-batch
