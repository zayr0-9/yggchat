#!/bin/bash
curl -X POST http://localhost:3002/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "ripgrep",
    "args": {
      "pattern": "canSendLocal",
      "searchPath": "/home/karn/webbdrasil/Webdrasil/ygg-chat/client/ygg-chat-r/src"
    },
    "rootPath": "/home/karn/webbdrasil",
    "operationMode": "execute"
  }'
echo ""
