#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Multi-instance subagent manager
# Each instance gets a unique name and port, tracked via Docker labels.
CONTAINER_PREFIX="embry-subagent"
DOCKER_LABEL="embry.skill=subagent-service"
IMAGE_NAME="subagent-service:latest"
PORT_BASE=8620
PORT_MAX=8629
CLAUDE_HOME="${HOME}/.claude"
CODEX_HOME="${HOME}/.codex"
GEMINI_HOME="${HOME}/.gemini"
SKILLS_DIR="/home/graham/workspace/experiments/pi-mono/.pi/skills"
AGENTS_DIR="/home/graham/workspace/experiments/pi-mono/.pi/agents"
PI_DIR="/home/graham/workspace/experiments/pi-mono/.pi"

# Host services the container connects to
EMBEDDING_SERVICE_URL="${EMBEDDING_SERVICE_URL:-http://127.0.0.1:8602}"
MEMORY_ARANGO_URL="${MEMORY_ARANGO_URL:-http://127.0.0.1:8529}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_container_name() {
    # Generate container name from instance name (default: "default")
    local name="${1:-default}"
    echo "${CONTAINER_PREFIX}-${name}"
}

_list_containers() {
    # List all subagent containers (running or stopped)
    docker ps -a --filter "label=${DOCKER_LABEL}" --format '{{.Names}}\t{{.Status}}\t{{.Label "embry.port"}}' 2>/dev/null
}

_list_running() {
    # List only running subagent containers
    docker ps --filter "label=${DOCKER_LABEL}" --format '{{.Names}}\t{{.Label "embry.port"}}' 2>/dev/null
}

_used_ports() {
    # Return ports used by running subagent containers
    docker ps --filter "label=${DOCKER_LABEL}" --format '{{.Label "embry.port"}}' 2>/dev/null
}

_next_free_port() {
    # Find next available port in the pool (checks Docker labels AND host bind)
    local used
    used=$(_used_ports)
    for port in $(seq "${PORT_BASE}" "${PORT_MAX}"); do
        if echo "$used" | grep -q "^${port}$"; then
            continue
        fi
        # Also verify port is not bound on host (catches non-Docker listeners)
        if ss -tln "sport = :${port}" 2>/dev/null | grep -q "${port}"; then
            continue
        fi
        echo "$port"
        return 0
    done
    echo ""
    return 1
}

_get_port_for() {
    # Get port for a named instance
    local cname="$1"
    docker inspect --format '{{index .Config.Labels "embry.port"}}' "$cname" 2>/dev/null
}

_resolve_target() {
    # Resolve instance name or port for commands that target a specific instance.
    # With no arg, returns the default or only running instance.
    local target="${1:-}"
    if [[ -n "$target" ]]; then
        local cname
        cname="$(_container_name "$target")"
        if docker ps --format '{{.Names}}' | grep -q "^${cname}$"; then
            echo "$cname"
            return 0
        fi
        # Maybe they passed a full container name
        if docker ps --format '{{.Names}}' | grep -q "^${target}$"; then
            echo "$target"
            return 0
        fi
        echo ""
        return 1
    fi
    # No target — try default, then fall back to the only running instance
    local cname
    cname="$(_container_name default)"
    if docker ps --format '{{.Names}}' | grep -q "^${cname}$"; then
        echo "$cname"
        return 0
    fi
    # If exactly one instance running, use it
    local running
    running=$(docker ps --filter "label=${DOCKER_LABEL}" --format '{{.Names}}' 2>/dev/null)
    local count
    count=$(echo "$running" | grep -c . 2>/dev/null || echo 0)
    if [[ "$count" -eq 1 ]]; then
        echo "$running"
        return 0
    fi
    echo ""
    return 1
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

usage() {
    cat <<'EOF'
subagent-service: Multi-instance Dockerized agent with FastAPI endpoint

Commands:
  start [--name N] [--port P] [--workspace PATH] [--no-skills] [--no-memory]
                     Start a named agent instance (default name: "default")
  stop [NAME]        Stop and remove a named instance
  stop --all         Stop and remove ALL subagent instances
  list               List all subagent instances with status and ports
  status [NAME]      Show health of a named instance (or default)
  test [BACKEND] [--name N]  Send test prompt to an instance
  logs [NAME]        Tail container logs
  build              Build the Docker image only
  cleanup            Remove stopped, restarting, or unhealthy instances
  backends [NAME]    List available backends and models
  usage [NAME]       Show accumulated usage/cost stats

Quick run (targets default or only running instance):
  claude PROMPT      Send prompt to Claude
  codex PROMPT       Send prompt to Codex
  gemini PROMPT      Send prompt to Gemini

Images:
  --images FILE...   Attach image files for vision review (auto base64-encoded)

Workspace:
  --workspace PATH   Mount a host directory (read-write) so the agent can
                     see and edit local code. Sets cwd for CLI backends.

Multi-instance examples:
  ./run.sh start                           # Start "default" on port 8620
  ./run.sh start --name reviewer           # Start "reviewer" on next free port
  ./run.sh start --name coder --port 8622  # Start "coder" on specific port
  ./run.sh start --workspace ~/project     # Start with workspace mounted
  ./run.sh list                            # Show all instances
  ./run.sh stop reviewer                   # Stop specific instance
  ./run.sh stop --all                      # Stop ALL instances (cleanup)

Port pool: 8620-8629 (10 max concurrent instances)
EOF
}

build_image() {
    echo "Building ${IMAGE_NAME}..."
    if [[ -f "${SCRIPT_DIR}/docker-compose.yml" ]]; then
        docker compose -f "${SCRIPT_DIR}/docker-compose.yml" build
    else
        docker build -t "${IMAGE_NAME}" "${SCRIPT_DIR}"
    fi
    echo "Image built: ${IMAGE_NAME}"
}

start_container() {
    local instance_name="${1:-default}"
    local port="$2"
    local with_skills="${3:-true}"
    local with_memory="${4:-true}"
    local workspace="${5:-}"

    local cname
    cname="$(_container_name "$instance_name")"

    # Check if already running
    if docker ps --format '{{.Names}}' | grep -q "^${cname}$"; then
        local existing_port
        existing_port=$(_get_port_for "$cname")

        # If workspace was requested, verify the running container has the right one mounted.
        # A stale mount from a previous run silently gives agents the wrong cwd.
        if [[ -n "$workspace" ]]; then
            local abs_workspace current_ws
            abs_workspace=$(cd "$workspace" 2>/dev/null && pwd) || { echo "ERROR: Workspace '$workspace' not found"; exit 1; }
            current_ws=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/workspace"}}{{.Source}}{{end}}{{end}}' "$cname" 2>/dev/null)
            if [[ "$current_ws" != "$abs_workspace" ]]; then
                echo "Workspace changed (${current_ws:-<none>} → ${abs_workspace}), restarting '${instance_name}'..."
                docker rm -f "$cname" >/dev/null 2>&1
                # Fall through to create new container below
            else
                echo "Instance '${instance_name}' already running on port ${existing_port}"
                return 0
            fi
        else
            echo "Instance '${instance_name}' already running on port ${existing_port}"
            return 0
        fi
    fi

    # Remove stopped container with same name if exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${cname}$"; then
        docker rm -f "$cname" >/dev/null 2>&1
    fi

    # Auto-allocate port if not specified
    if [[ -z "$port" ]]; then
        port=$(_next_free_port)
        if [[ -z "$port" ]]; then
            echo "ERROR: No free ports in pool ${PORT_BASE}-${PORT_MAX}"
            echo "Run './run.sh list' to see instances, './run.sh stop --all' to clean up."
            exit 1
        fi
    fi

    # Verify port not in use by another instance
    if _used_ports | grep -q "^${port}$"; then
        echo "ERROR: Port ${port} already in use by another subagent instance"
        _list_running
        exit 1
    fi

    # Build image if needed
    if ! docker image inspect "${IMAGE_NAME}" &>/dev/null; then
        build_image
    fi

    # Validate credentials
    if [[ ! -f "${CLAUDE_HOME}/.credentials.json" ]]; then
        echo "ERROR: No OAuth credentials at ${CLAUDE_HOME}/.credentials.json"
        echo "Run 'claude' interactively first to authenticate."
        exit 1
    fi
    if ! python3 -c "import sys, json; json.load(open('${CLAUDE_HOME}/.credentials.json'))" 2>/dev/null; then
        echo "ERROR: ${CLAUDE_HOME}/.credentials.json is not valid JSON"
        exit 1
    fi

    # --- Volumes: auth dirs ---
    local -a volumes=(
        -v "${CLAUDE_HOME}:/home/node/.claude"
    )
    [[ -d "${CODEX_HOME}" ]] && volumes+=(-v "${CODEX_HOME}:/home/node/.codex")
    [[ -d "${GEMINI_HOME}" ]] && volumes+=(-v "${GEMINI_HOME}:/home/node/.gemini")

    # --- Skills (default: mount all skills + agents read-only) ---
    if [[ "$with_skills" == "true" ]]; then
        if [[ -d "${SKILLS_DIR}" ]]; then
            volumes+=(-v "${SKILLS_DIR}:/home/node/skills")
            echo "  Skills: mounted (read-write)"
        fi
        if [[ -d "${AGENTS_DIR}" ]]; then
            volumes+=(-v "${AGENTS_DIR}:/home/node/agents:ro")
            echo "  Agents: mounted (read-only)"
        fi
    fi

    # --- Workspace (shared volume) ---
    if [[ -n "$workspace" ]]; then
        local abs_workspace
        abs_workspace=$(cd "$workspace" 2>/dev/null && pwd) || { echo "ERROR: Workspace '$workspace' not found"; exit 1; }
        volumes+=(-v "${abs_workspace}:/home/node/workspace")
        echo "  Workspace: ${abs_workspace} (read-write)"
    fi

    # --- 12TB storage (heavy artifacts, models, training data) ---
    # Mount at same host path so skills using absolute paths work unchanged.
    # Also mount at /home/node/workspace/storage for Claude Code sandbox access.
    if [[ -d "/mnt/storage12tb" ]]; then
        volumes+=(-v "/mnt/storage12tb:/mnt/storage12tb:ro")
        echo "  Storage: /mnt/storage12tb (read-only)"
    fi

    # --- Environment ---
    local -a env_args=(
        -e "SUBAGENT_PORT=${port}"
        -e "CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000"
    )
    if [[ -n "$workspace" ]]; then
        env_args+=(-e "WORKSPACE_DIR=/home/node/workspace")
    fi
    if [[ "$with_memory" == "true" ]]; then
        env_args+=(-e "EMBEDDING_SERVICE_URL=${EMBEDDING_SERVICE_URL}")
        env_args+=(-e "MEMORY_ARANGO_URL=${MEMORY_ARANGO_URL}")
        # Mount memory daemon Unix socket so agents can use httpx UDS transport
        local socket_dir="/run/user/$(id -u)/embry"
        if [[ -S "${socket_dir}/memory.sock" ]]; then
            volumes+=(-v "${socket_dir}:${socket_dir}")
            env_args+=(-e "MEMORY_SOCKET=${socket_dir}/memory.sock")
            echo "  Memory socket: ${socket_dir}/memory.sock (mounted)"
        fi
        # scillm LLM gateway (--network host makes it reachable, but set env for clarity)
        env_args+=(-e "SCILLM_URL=${SCILLM_URL:-http://localhost:4001}")
        echo "  Memory: ${MEMORY_ARANGO_URL}"
        echo "  Embedding: ${EMBEDDING_SERVICE_URL}"
        echo "  scillm: ${SCILLM_URL:-http://localhost:4001}"
    fi

    echo "Starting '${instance_name}' (port ${port})..."
    # GPU passthrough for ML training (torch/timm) — falls back gracefully if no GPU
    local gpu_flag=""
    if command -v nvidia-smi &>/dev/null; then
        gpu_flag="--gpus all"
        echo "  GPU: NVIDIA detected — passing through"
    fi

    docker run -d \
        --name "${cname}" \
        --network host \
        --shm-size=2g \
        ${gpu_flag} \
        --label "${DOCKER_LABEL}" \
        --label "embry.port=${port}" \
        --label "embry.instance=${instance_name}" \
        "${volumes[@]}" \
        "${env_args[@]}" \
        --restart unless-stopped \
        "${IMAGE_NAME}"

    echo -n "Waiting for health check"
    for i in $(seq 1 15); do
        if curl -sf "http://localhost:${port}/health" &>/dev/null; then
            echo " OK"
            curl -s "http://localhost:${port}/health" | python3 -m json.tool 2>/dev/null || true
            return 0
        fi
        echo -n "."
        sleep 2
    done
    echo " TIMEOUT"
    echo "Container may still be starting. Check: docker logs ${cname}"
    return 1
}

stop_container() {
    local target="$1"

    if [[ "$target" == "--all" ]]; then
        local containers
        containers=$(docker ps -a --filter "label=${DOCKER_LABEL}" --format '{{.Names}}' 2>/dev/null)
        if [[ -z "$containers" ]]; then
            echo "No subagent instances to stop."
            return 0
        fi
        local count=0
        while IFS= read -r cname; do
            docker rm -f "$cname" >/dev/null 2>&1
            echo "  Stopped: ${cname}"
            count=$((count + 1))
        done <<< "$containers"
        echo "Cleaned up ${count} instance(s)."
        return 0
    fi

    local cname
    if [[ -n "$target" ]]; then
        cname="$(_container_name "$target")"
    else
        cname="$(_container_name default)"
    fi

    if docker ps -a --format '{{.Names}}' | grep -q "^${cname}$"; then
        docker rm -f "$cname" >/dev/null 2>&1
        echo "Stopped and removed: ${cname}"
    else
        echo "Instance '${target:-default}' not found."
        echo "Running instances:"
        _list_running
    fi
}

cleanup_stale() {
    # Remove stopped, restarting, or unhealthy subagent containers
    local containers
    containers=$(docker ps -a --filter "label=${DOCKER_LABEL}" --format '{{.Names}}\t{{.Status}}\t{{.Label "embry.port"}}' 2>/dev/null)
    if [[ -z "$containers" ]]; then
        echo "No subagent instances to clean up."
        return 0
    fi

    local removed=0
    while IFS=$'\t' read -r name status port; do
        local stale=false
        # Stopped containers
        if echo "$status" | grep -qi "^Exited"; then
            stale=true
        fi
        # Restart-looping containers
        if echo "$status" | grep -qi "^Restarting"; then
            stale=true
        fi
        # Running but health check fails
        if echo "$status" | grep -qi "^Up"; then
            if ! curl -sf --max-time 5 "http://localhost:${port}/health" &>/dev/null; then
                stale=true
            fi
        fi

        if [[ "$stale" == "true" ]]; then
            docker rm -f "$name" >/dev/null 2>&1
            echo "  Removed stale: ${name} (was: ${status})"
            removed=$((removed + 1))
        fi
    done <<< "$containers"

    if [[ "$removed" -eq 0 ]]; then
        echo "All instances are healthy — nothing to clean up."
    else
        echo "Cleaned up ${removed} stale instance(s)."
    fi
}

list_instances() {
    local containers
    containers=$(_list_containers)
    if [[ -z "$containers" ]]; then
        echo "No subagent instances."
        return 0
    fi

    printf "%-30s %-15s %-6s %-8s\n" "CONTAINER" "STATUS" "PORT" "HEALTH"
    printf "%-30s %-15s %-6s %-8s\n" "─────────" "──────" "────" "──────"

    while IFS=$'\t' read -r name status port; do
        local health="—"
        if echo "$status" | grep -qi "^Up"; then
            local short_status
            short_status=$(echo "$status" | sed 's/ (.*//')
            if curl -sf --max-time 5 "http://localhost:${port}/health" &>/dev/null; then
                health="OK"
            else
                health="FAIL"
            fi
            printf "%-30s %-15s %-6s %-8s\n" "$name" "$short_status" "$port" "$health"
        else
            local short_status
            short_status=$(echo "$status" | head -c 14)
            printf "%-30s %-15s %-6s %-8s\n" "$name" "$short_status" "$port" "$health"
        fi
    done <<< "$containers"

    local running
    running=$(docker ps --filter "label=${DOCKER_LABEL}" --format '.' 2>/dev/null | wc -l)
    local total
    total=$(docker ps -a --filter "label=${DOCKER_LABEL}" --format '.' 2>/dev/null | wc -l)
    echo ""
    echo "${running} running / ${total} total (port pool: ${PORT_BASE}-${PORT_MAX})"
}

show_status() {
    local cname
    cname=$(_resolve_target "$1") || true
    if [[ -z "$cname" ]]; then
        echo "No instance found. Use './run.sh list' to see instances."
        return 1
    fi
    local port
    port=$(_get_port_for "$cname")
    local instance
    instance=$(docker inspect --format '{{index .Config.Labels "embry.instance"}}' "$cname" 2>/dev/null)
    echo "Instance: ${instance} (${cname})"
    echo "Port: ${port}"
    if docker ps --format '{{.Names}}' | grep -q "^${cname}$"; then
        echo "Status: RUNNING"
        curl -s "http://localhost:${port}/health" | python3 -m json.tool 2>/dev/null || echo "Health check failed"
    else
        echo "Status: STOPPED"
    fi
}

send_prompt_safe() {
    local backend="$1"
    shift
    local target_name=""
    local prompt_parts=()
    local image_files=()
    local max_turns="${SUBAGENT_MAX_TURNS:-5}"
    local idle_timeout="${SUBAGENT_IDLE_TIMEOUT:-0}"

    # Parse --name, --images, --max-turns, --timeout, and --stream flags
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name) target_name="$2"; shift 2 ;;
            --max-turns) max_turns="$2"; shift 2 ;;
            --timeout) idle_timeout="$2"; shift 2 ;;
            --stream) export SUBAGENT_STREAM=1; shift ;;
            --images) shift; while [[ $# -gt 0 && "$1" != --* ]]; do image_files+=("$1"); shift; done ;;
            *) prompt_parts+=("$1"); shift ;;
        esac
    done

    local prompt="${prompt_parts[*]}"

    # If prompt is a file path, read it
    if [[ -f "$prompt" ]]; then
        prompt="$(cat "$prompt")"
    fi

    local cname
    cname=$(_resolve_target "$target_name") || true
    if [[ -z "$cname" ]]; then
        echo "No instance found. Start one first: ./run.sh start"
        exit 1
    fi

    local port
    port=$(_get_port_for "$cname")

    # Use python for safe JSON encoding (handles quotes, newlines, images)
    local json_body
    json_body=$(python3 -c "
import json, sys, base64, mimetypes

prompt = sys.stdin.read()
model = '$backend'
image_paths = '''${image_files[*]}'''.split()

images = []
for p in image_paths:
    if not p:
        continue
    mime = mimetypes.guess_type(p)[0] or 'image/png'
    with open(p, 'rb') as f:
        data = base64.b64encode(f.read()).decode()
    images.append({'data': data, 'media_type': mime, 'filename': p.rsplit('/', 1)[-1]})

body = {'prompt': prompt, 'model': model, 'max_turns': $max_turns, 'idle_timeout': $idle_timeout}
if images:
    body['images'] = images
print(json.dumps(body))
" <<< "$prompt")

    if [[ "${SUBAGENT_STREAM:-0}" == "1" ]]; then
        # SSE streaming — show events as they arrive
        curl -sN -X POST "http://localhost:${port}/chat/stream" \
            -H "Content-Type: application/json" \
            -d "$json_body" 2>/dev/null \
            | python3 -c "
import sys
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith(':'):
        continue
    if line.startswith('data: '):
        import json
        try:
            evt = json.loads(line[6:])
            etype = evt.get('type', '')
            if etype == 'assistant':
                msg = evt.get('message', {})
                for block in msg.get('content', []):
                    if block.get('type') == 'text':
                        print(block['text'], end='', flush=True)
            elif etype == 'text':
                print(evt.get('content', ''), flush=True)
            elif etype == 'result':
                msg = evt.get('result', evt.get('message', ''))
                if isinstance(msg, str) and msg:
                    print(msg, end='', flush=True)
            elif etype == 'heartbeat':
                elapsed = evt.get('elapsed_ms', 0) // 1000
                idle = evt.get('idle_seconds', 0)
                print(f'\r\033[2m[{elapsed}s elapsed, {idle}s idle]\033[0m', end='', file=sys.stderr, flush=True)
            elif etype == 'done':
                dur = evt.get('duration_ms', 0) // 1000
                print(f'\n\033[2m--- done ({dur}s, {evt.get(\"num_events\", 0)} events, exit {evt.get(\"exit_code\", \"?\")})\033[0m', file=sys.stderr)
            elif etype == 'error':
                print(f'\n\033[31mERROR: {evt.get(\"message\", \"unknown\")}\033[0m', file=sys.stderr)
            elif etype == 'meta':
                print(f'\033[2m--- {evt.get(\"backend\", \"?\")} / {evt.get(\"model\", \"?\")}\033[0m', file=sys.stderr)
        except json.JSONDecodeError:
            pass
"
    else
        curl -s -X POST "http://localhost:${port}/chat" \
            -H "Content-Type: application/json" \
            -d "$json_body" \
            | python3 -m json.tool 2>/dev/null
    fi
}

test_prompt() {
    local backend="${1:-claude}"
    local name_flag=""
    if [[ "$2" == "--name" ]]; then
        name_flag="--name $3"
    fi
    send_prompt_safe "$backend" $name_flag "Reply with exactly: hello from subagent-service via $backend"
}

show_backends() {
    local cname
    cname=$(_resolve_target "$1") || true
    if [[ -z "$cname" ]]; then
        echo "No running instance — showing backends.yml:"
        cat "${SCRIPT_DIR}/backends.yml"
        return
    fi
    local port
    port=$(_get_port_for "$cname")
    curl -s "http://localhost:${port}/backends" | python3 -m json.tool 2>/dev/null
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

case "${1:-help}" in
    start)
        shift
        INSTANCE_NAME="default"
        PORT=""
        WITH_SKILLS="true"
        WITH_MEMORY="true"
        WORKSPACE=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --name) INSTANCE_NAME="$2"; shift 2 ;;
                --port) PORT="$2"; shift 2 ;;
                --workspace) WORKSPACE="$2"; shift 2 ;;
                --no-skills) WITH_SKILLS="false"; shift ;;
                --no-memory) WITH_MEMORY="false"; shift ;;
                *) shift ;;
            esac
        done
        start_container "${INSTANCE_NAME}" "${PORT}" "${WITH_SKILLS}" "${WITH_MEMORY}" "${WORKSPACE}"
        ;;
    stop)
        shift
        stop_container "${1:-}"
        ;;
    list|ls)
        list_instances
        ;;
    status)
        shift
        show_status "$1"
        ;;
    test)
        shift
        test_prompt "$@"
        ;;
    logs)
        shift
        CNAME=$(_resolve_target "$1") || true
        if [[ -z "$CNAME" ]]; then
            echo "No instance found."
            exit 1
        fi
        docker logs -f "$CNAME" 2>/dev/null || echo "Container not running"
        ;;
    build)
        build_image
        ;;
    cleanup)
        cleanup_stale
        ;;
    backends)
        shift
        show_backends "$1"
        ;;
    usage)
        shift
        CNAME=$(_resolve_target "$1") || true
        if [[ -z "$CNAME" ]]; then
            echo "No instance found."
            exit 1
        fi
        PORT=$(_get_port_for "$CNAME")
        curl -s "http://localhost:${PORT}/usage" | python3 -m json.tool 2>/dev/null
        ;;
    claude|codex|gemini)
        BACKEND="$1"
        shift
        if [[ $# -eq 0 ]]; then
            echo "Usage: ./run.sh $BACKEND <prompt or PROMPT.md> [--name INSTANCE]"
            exit 1
        fi
        send_prompt_safe "$BACKEND" "$@"
        ;;
    help|*)
        usage
        ;;
esac
