#!/bin/bash

set -eo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
APP_ROOT=$SCRIPT_DIR/..

cd $APP_ROOT

. "$SCRIPT_DIR/setup-node.sh"

# Allow only one geocode run at a time. A batch that overruns the hourly cron
# would otherwise overlap the next run, and both could miss the same
# ham_location row and try to insert it, tripping the unique key on
# (latitude, longitude) and aborting the batch.
#
# The lock is held on fd 9 and released by the kernel when this script exits,
# so it cannot go stale even if the run is killed.
mkdir -p logs
LOCK_FILE="$APP_ROOT/logs/geocode.lock"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"

  if ! flock -n 9; then
    # Not an error: the previous run is simply still going. Logged rather than
    # silent, because repeated skips mean batches are taking over an hour.
    dist/index.js write-log 'Geocode run skipped: previous run still in progress' warn || true
    exit 0
  fi
else
  # flock is util-linux, present on the Ubuntu server but not on macOS.
  echo "flock unavailable, running without a concurrency guard" >&2
fi

dist/index.js geocode-batch
