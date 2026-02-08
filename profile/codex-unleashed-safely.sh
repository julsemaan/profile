#!/bin/bash

set -o nounset -o pipefail -o errexit

MNT=${1:-$PWD}
REBUILD=${REBUILD:-}

if ! [ -z "$REBUILD" ]; then
  echo "Rebuilding the Docker image..."
  docker image rm codex-unleashed-safely:latest || true
fi

docker build -t codex-unleashed-safely - <<EOF
FROM node:20-bookworm

RUN npm i -g @openai/codex

ENTRYPOINT ["codex", "--dangerously-bypass-approvals-and-sandbox"]
EOF

docker run --rm -it \
  -e OPENAI_API_KEY \
  -e CODEX_APPROVALS=never \
  -e CODEX_HOME=/codex \
  -v ~/.codex:/codex \
  -v "$MNT:$MNT" -w $PWD \
  codex-unleashed-safely:latest 
