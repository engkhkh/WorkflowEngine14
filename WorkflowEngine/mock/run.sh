#!/bin/bash
fuser -k 5000/tcp 4200/tcp >/dev/null 2>&1; sleep 1
nohup node /home/claude/we/mock/server2.js /home/claude/we/portal-app/dist/workflow-engine-portal 4200 > /tmp/srv.log 2>&1 &
sleep 2
cd /home/claude/we/mock && timeout 170 python3 "$1" 2>&1 | grep -v "^    \|^  File\|^Traceback" | tail -${2:-15}
