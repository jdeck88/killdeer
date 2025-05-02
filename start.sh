#!/bin/sh
pm2 start killdeer.v2.js --max-memory-restart 300M --node-args="--max_old_space_size=300"  --log-date-format="YYYY-MM-DD HH:mm Z"
