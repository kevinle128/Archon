#!/bin/bash
# start-driver.sh: run the Playwright driver in the foreground; records its PID in driver.pid.
cd "$(dirname "$0")"
echo $$ > driver.pid
exec node driver.mjs 7871 5303 3435 9789fa692a91f055da3cfa6cd25065c0
