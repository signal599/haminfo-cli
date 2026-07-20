#!/bin/bash

set -eo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd $SCRIPT_DIR
./download-fcc-data.sh

res=$?
if test "$res" != "0"; then
   # Propagate the real status: a bare `exit` here would return the status of
   # the preceding `test`, which is 0, and hide the failure from cron.
   exit $res
fi

./update-fcc-data.sh
