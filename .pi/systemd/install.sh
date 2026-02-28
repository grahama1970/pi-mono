#!/usr/bin/env bash
# Install Embry OS systemd user services.
# Usage: bash install.sh [--uninstall] [--service NAME]
#   --service NAME   Install only the named service (embry-agent, embry-scillm)
#   --uninstall      Remove services instead of installing
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"

# All managed services
ALL_SERVICES=("embry-agent.service" "embry-scillm.service")

# Parse arguments
UNINSTALL=false
TARGET_SERVICES=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --uninstall) UNINSTALL=true; shift ;;
        --service)
            TARGET_SERVICES+=("${2}.service")
            shift 2
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Default to all services if none specified
if [[ ${#TARGET_SERVICES[@]} -eq 0 ]]; then
    TARGET_SERVICES=("${ALL_SERVICES[@]}")
fi

if $UNINSTALL; then
    for svc in "${TARGET_SERVICES[@]}"; do
        echo "[${svc%.service}] Uninstalling..."
        systemctl --user stop "$svc" 2>/dev/null || true
        systemctl --user disable "$svc" 2>/dev/null || true
        rm -f "${UNIT_DIR}/${svc}"
    done
    systemctl --user daemon-reload
    echo "Uninstalled: ${TARGET_SERVICES[*]}"
    exit 0
fi

echo "Installing Embry OS systemd user services..."

# Ensure unit directory exists
mkdir -p "$UNIT_DIR"

for svc in "${TARGET_SERVICES[@]}"; do
    if [[ ! -f "${SCRIPT_DIR}/${svc}" ]]; then
        echo "[${svc%.service}] WARNING: ${svc} not found in ${SCRIPT_DIR}, skipping"
        continue
    fi
    # Symlink the service file
    ln -sf "${SCRIPT_DIR}/${svc}" "${UNIT_DIR}/${svc}"
    echo "[${svc%.service}] Linked"
done

# Reload systemd
systemctl --user daemon-reload

# Enable all target services
for svc in "${TARGET_SERVICES[@]}"; do
    if [[ -f "${UNIT_DIR}/${svc}" ]]; then
        systemctl --user enable "$svc"
        echo "[${svc%.service}] Enabled"
    fi
done

echo ""
echo "Installed: ${TARGET_SERVICES[*]}"
echo "Start with: systemctl --user start <service-name>"
echo "Check status: systemctl --user status <service-name>"
echo "View logs: journalctl --user -u <service-name> -f"
