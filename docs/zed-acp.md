# Using little-coder inside Zed (ACP bridge)

little-coder doesn't ship an [Agent Client Protocol](https://agentclientprotocol.com/) (ACP)
server of its own — the structured JSON you see from `little-coder --mode rpc` is
pi's **internal extension-UI RPC** (`setTitle` / `notify` / `setWidget`), not ACP,
so Zed's agent panel can't drive it directly (issue
[#58](https://github.com/itayinbarr/little-coder/issues/58)).

However, the community has little-coder working in Zed's agent panel today by
putting [**pi-acp**](https://github.com/svkozak/pi-acp) in front of it. pi-acp is
an ACP↔pi bridge; because pi-acp spawns its underlying agent via a command you
control (`PI_ACP_PI_COMMAND`), you can point it at the `little-coder` binary
instead of bare `pi`, and every bundled extension/skill comes along.

> **Unofficial / community-maintained.** pi-acp is a third-party project and this
> setup isn't part of little-coder's test matrix. It's documented here because it
> works well in practice (thanks to [@BMorgan1296](https://github.com/BMorgan1296)
> for the recipe). An official first-class ACP transport really belongs in pi
> upstream — if it lands there, both pi and little-coder benefit — so this bridge
> is the pragmatic path until then.

## 1. Install pi-acp

```bash
npm install -g pi-acp
```

No configuration is required inside pi-acp itself — the only lever you need is the
`PI_ACP_PI_COMMAND` environment variable, which tells it to launch little-coder in
place of `pi --mode rpc`.

## 2. Point Zed at little-coder

Add an `agent_servers` entry to Zed's `settings.json`. The wrapper script below
(`little-coder-acp`) starts a local `llama-server`, waits for it to become ready,
then launches pi-acp with `PI_ACP_PI_COMMAND` set to little-coder — and kills the
llama-server again when Zed closes the session.

```jsonc
{
  "agent_servers": {
    "little-coder": {
      "type": "custom",
      "command": "/usr/local/bin/little-coder-acp",
      "args": [],
      "env": {
        "LLAMACPP_BASE_URL": "http://127.0.0.1:8888/v1",
        "LLAMACPP_API_KEY": "noop",
        "PI_ACP_PI_COMMAND": "/usr/local/bin/little-coder",
        "PI_SKIP_VERSION_CHECK": "1"
      }
    }
  }
}
```

Adjust the paths for your machine (`command -v little-coder` and `command -v pi-acp`
tell you where they landed).

## 3. The wrapper script

Save this as `little-coder-acp` somewhere on your `PATH` and `chmod +x` it. It is a
lightly-generalized version of the recipe from issue #58 — edit `LLAMA_SERVER`,
`MODEL`, and the context size (`-c`) for your hardware. Everything is logged to
`$XDG_STATE_HOME/lc-qwen/llama-server.log`, and **all** wrapper logging goes to
stderr because ACP owns stdout for JSON-RPC.

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
LLAMA_SERVER="$HOME/tools/llama.cpp/build/bin/llama-server"
MODEL="$HOME/models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"

HOST="127.0.0.1"
PORT="8888"
BASE_URL="http://${HOST}:${PORT}/v1"

LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/lc-qwen"
LOG_FILE="${LOG_DIR}/llama-server.log"

SERVER_PID=""

export PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"

log() { echo "$@" >&2; }   # never write to stdout — ACP uses it for JSON-RPC

cleanup() {
  local code=$?
  trap - EXIT INT TERM HUP
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    log "Stopping llama-server..."
    kill "${SERVER_PID}" 2>/dev/null || true
    for _ in {1..30}; do
      kill -0 "${SERVER_PID}" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM HUP

# ── Sanity checks ──────────────────────────────────────────────────────────
[[ -x "$LLAMA_SERVER" ]] || { log "llama-server not found: $LLAMA_SERVER"; exit 1; }
[[ -f "$MODEL" ]]        || { log "model not found: $MODEL"; exit 1; }
LC_BIN="$(command -v little-coder || true)";  [[ -n "$LC_BIN" ]]      || { log "little-coder not on PATH"; exit 1; }
PI_ACP_BIN="$(command -v pi-acp || true)";    [[ -n "$PI_ACP_BIN" ]] || { log "pi-acp not on PATH"; exit 1; }

# ── 1. Start llama-server (refuse to double-start) ─────────────────────────
if curl -fsS "${BASE_URL}/models" >/dev/null 2>&1; then
  log "Something already listening at ${BASE_URL}; not starting a second server."
  exit 1
fi
mkdir -p "$LOG_DIR"; : >"$LOG_FILE"
log "Starting llama-server (log: $LOG_FILE)"
(
  exec "$LLAMA_SERVER" \
    -m "$MODEL" --host "$HOST" --port "$PORT" \
    --jinja --alias "qwen3.6-35b-a3b" \
    -c 65536 -ngl 99 --n-cpu-moe 999 --flash-attn on --no-mmap -t 12
) >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

log "Waiting for llama-server..."
for _ in {1..600}; do
  curl -fsS "${BASE_URL}/models" >/dev/null 2>&1 && { log "ready."; break; }
  kill -0 "${SERVER_PID}" 2>/dev/null || { log "llama-server exited early:"; tail -n 80 "$LOG_FILE" >&2; exit 1; }
  sleep 1
done
curl -fsS "${BASE_URL}/models" >/dev/null 2>&1 || { log "timed out waiting for llama-server"; tail -n 80 "$LOG_FILE" >&2; exit 1; }

# ── 2. Launch pi-acp, telling it to spawn little-coder ─────────────────────
export LLAMACPP_BASE_URL="$BASE_URL"
export LLAMACPP_API_KEY="${LLAMACPP_API_KEY:-noop}"
export PI_ACP_PI_COMMAND="$LC_BIN"
export PI_SKIP_VERSION_CHECK=1

log "Launching pi-acp with PI_ACP_PI_COMMAND=$PI_ACP_PI_COMMAND"
exec "$PI_ACP_BIN"
```

## Notes

- The wrapper uses a **65 K** context (`-c 65536`); size it to your VRAM.
- If you already run llama-server as a separate service (e.g. behind the
  `route_proxy` auto-router), drop the "Start llama-server" block and just export
  `LLAMACPP_BASE_URL` to point at it.
- Because this launches the *same* `little-coder` binary, the in-app update
  prompt could interfere with the JSON-RPC stream — `PI_SKIP_VERSION_CHECK=1`
  plus running non-interactively keeps it quiet; set
  `LITTLE_CODER_NO_UPDATE_CHECK=1` in the `env` block if you want to be certain.
