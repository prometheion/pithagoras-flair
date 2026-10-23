#!/bin/sh
# The Blender image's smoke test, as the release runs it before the image is pushed: the image started with no GPU, a
# random token and the server's port on this machine's loopback (host network), until MCP answers; its tools/list and
# the instructions its initialize gives compared with blender/server/tools.json, which is what the extension relays (a
# change to the server's tools or instructions changes that file, the label table and its German); the viewer's routes
# refused without the token; then the container removed.
#   scripts/smoke-blender.sh <image>        SMOKE_PORT (default 3870) and SMOKE_NAME (default blender-smoke) change them
set -eu
ts() { date "+%Y-%m-%d %H:%M:%S"; }
IMAGE="$1"
PORT="${SMOKE_PORT:-3870}"
NAME="${SMOKE_NAME:-blender-smoke}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOKEN=$(openssl rand -hex 24)
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "$(ts) starting $IMAGE as $NAME on 127.0.0.1:$PORT"
docker run -d --name "$NAME" --network host -e BLENDER_SERVER_TOKEN="$TOKEN" -e BLENDER_SERVER_PORT="$PORT" "$IMAGE" >/dev/null
mcp() { curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1" "http://127.0.0.1:$PORT/mcp"; }

echo "$(ts) waiting for MCP to answer ping"
i=0
until mcp '{"jsonrpc":"2.0","id":1,"method":"ping"}' | grep -q '"result"'; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then docker logs "$NAME" | tail -40; echo "$(ts) MCP did not answer in 120 s"; exit 1; fi
  sleep 1
done

echo "$(ts) comparing initialize's instructions and tools/list with blender/server/tools.json"
mcp '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' > "/tmp/$NAME-init.json"
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/list"}' > "/tmp/$NAME-tools.json"
python3 -c '
import json, sys
instructions = json.load(open(sys.argv[1]))["result"]["instructions"]
tools = json.load(open(sys.argv[2]))["result"]["tools"]
kept = json.load(open(sys.argv[3]))
if instructions != kept["instructions"]:
    sys.exit("the image gives other instructions than blender/server/tools.json")
if tools != kept["tools"]:
    sys.exit("the image lists other tools than blender/server/tools.json")
print(len(tools), "tools and the instructions, as blender/server/tools.json has them")
' "/tmp/$NAME-init.json" "/tmp/$NAME-tools.json" "$ROOT/blender/server/tools.json"

for route in / /api/state /mcp; do
  method=GET; [ "$route" = /mcp ] && method=POST
  code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "http://127.0.0.1:$PORT$route")
  echo "$(ts) $method $route without the token: $code"
  [ "$code" = 401 ] || { echo "$(ts) $route answered $code without the token"; exit 1; }
done

echo "$(ts) DONE: $IMAGE answers MCP with its tools and refuses requests without the token"
