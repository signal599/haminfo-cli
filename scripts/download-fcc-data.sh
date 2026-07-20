#!/bin/bash

set -eo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
APP_ROOT=$SCRIPT_DIR/..

# The archive is around 190MB. Anything far below that is a truncated or error
# response rather than the real file, and must not reach the importers.
MIN_ZIP_BYTES=150000000

cd $APP_ROOT/downloads

rm -f l_amat.zip HD.dat EN.dat AM.dat

# HTTPS rather than the old plaintext FTP endpoint: this archive is loaded
# straight into the database, so it needs an authenticated transport.
# --fail turns an HTTP error page into a non-zero exit instead of a saved file.
curl --fail --location --show-error --retry 3 --retry-delay 30 \
  https://data.fcc.gov/download/pub/uls/complete/l_amat.zip --remote-name
res=$?
if test "$res" != "0"; then
   echo "Curl command failed with: $res"
   exit $res
fi

zip_bytes=$(wc -c < l_amat.zip)
if [ "$zip_bytes" -lt "$MIN_ZIP_BYTES" ]; then
   echo "Downloaded l_amat.zip is only $zip_bytes bytes, expected at least $MIN_ZIP_BYTES"
   exit 1
fi

# Verify the archive is intact before extracting: a partial download can still
# unzip the early members and silently yield a short HD.dat.
unzip -tq l_amat.zip
res=$?
if test "$res" != "0"; then
   echo "Zip integrity check failed with: $res"
   exit $res
fi

unzip -o l_amat.zip HD.dat EN.dat AM.dat
res=$?
if test "$res" != "0"; then
   echo "Unzip failed with: $res"
   exit $res
fi
