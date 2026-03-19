#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CONTAINER_NAME="create-claude"
IMAGE_NAME="create-claude:latest"
DEFAULT_PORT=8620
CLAUDE_HOME="${HOME}/.claude"
SKILLS_DIR="/home/graham/workspace/experiments/pi-mono/.pi/skills"

usage() {
    echo "create-claude: Dockerized Claude Code with FastAPI endpoint"
    echo ""
    echo "Commands:"
    echo "  start [--port N] [--with-skills]  Build and start the container"
    echo "  stop               Stop and remove the container"
    echo "  status             Show container status and test health"
    echo "  test               Send a test prompt"
    echo "  logs               Tail container logs"
    echo "  build              Build the Docker image only"
    echo ""
    echo "Options:"
    echo "  --port N           Port to expose (default: ${DEFAULT_PORT})"
    echo "  --with-skills      Mount .pi/skills read-only into container"
    echo ""
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
    local port="${1:-${DEFAULT_PORT}}"
    local with_skills="${2:-false}"

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Container already running on port $(docker port ${CONTAINER_NAME} 8620 2>/dev/null || echo unknown)"
        return 0
    fi

    # Build if image doesn't exist
    if ! docker image inspect "${IMAGE_NAME}" &>/dev/null; then
        build_image
    fi

    # Validate OAuth creds exist
    if [[ ! -f "${CLAUDE_HOME}/.credentials.json" ]]; then
        echo "ERROR: No OAuth credentials at ${CLAUDE_HOME}/.credentials.json"
        echo "Run 'claude' interactively first to authenticate."
        exit 1
    fi

    # Build volume mounts
    local -a volumes=(
        -v "${CLAUDE_HOME}:/home/node/.claude"
    )
    if [[ "$with_skills" == "true" ]]; then
        if [[ -d "${SKILLS_DIR}" ]]; then
            volumes+=(-v "${SKILLS_DIR}:/home/node/skills:ro")
            echo "Mounting skills directory (read-only)"
        else
            echo "WARN: Skills directory not found at ${SKILLS_DIR}"
        fi
    fi

    echo "Starting ${CONTAINER_NAME} on port ${port}..."
    docker run -d \
        --name "${CONTAINER_NAME}" \
        -p "${port}:8620" \
        "${volumes[@]}" \
        --restart unless-stopped \
        "${IMAGE_NAME}"

    # Wait for health
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
    echo "Container may still be starting. Check: docker logs ${CONTAINER_NAME}"
    return 1
}

stop_container() {
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker rm -f "${CONTAINER_NAME}"
        echo "Stopped and removed ${CONTAINER_NAME}"
    else
        echo "Container not running"
    fi
}

show_status() {
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        local port
        port=$(docker port "${CONTAINER_NAME}" 8620 2>/dev/null | head -1 | cut -d: -f2)
        echo "Status: RUNNING on port ${port}"
        curl -s "http://localhost:${port}/health" | python3 -m json.tool 2>/dev/null || echo "Health check failed"
    else
        echo "Status: STOPPED"
    fi
}

test_prompt() {
    local port
    port=$(docker port "${CONTAINER_NAME}" 8620 2>/dev/null | head -1 | cut -d: -f2)
    if [[ -z "$port" ]]; then
        echo "Container not running. Start it first: ./run.sh start"
        exit 1
    fi

    echo "Sending test prompt..."
    curl -s -X POST "http://localhost:${port}/chat" \
        -H "Content-Type: application/json" \
        -d '{"prompt": "Reply with exactly: hello from create-claude", "model": "sonnet", "max_turns": 1}' \
        | python3 -m json.tool 2>/dev/null
}

case "${1:-help}" in
    start)
        shift
        PORT="${DEFAULT_PORT}"
        WITH_SKILLS="false"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --port) PORT="$2"; shift 2 ;;
                --with-skills) WITH_SKILLS="true"; shift ;;
                *) shift ;;
            esac
        done
        start_container "${PORT}" "${WITH_SKILLS}"
        ;;
    stop)
        stop_container
        ;;
    status)
        show_status
        ;;
    test)
        test_prompt
        ;;
    logs)
        docker logs -f "${CONTAINER_NAME}" 2>/dev/null || echo "Container not running"
        ;;
    build)
        build_image
        ;;
    help|*)
        usage
        ;;
esac
