#!/usr/bin/env bash
# Install OESF LPR Site Agent on Linux (x86_64).
# Run from the extracted portable folder, or pass the binary path:
#   ./install.sh [path/to/oesf-lpr-agent]
set -euo pipefail

PREFIX="${OESF_LPR_AGENT_PREFIX:-/usr/local}"
BIN_DIR="${PREFIX}/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/oesf-lpr-agent"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  if [[ -x "$SCRIPT_DIR/oesf-lpr-agent" ]]; then
    SRC="$SCRIPT_DIR/oesf-lpr-agent"
  elif [[ -x "$SCRIPT_DIR/oesf-lpr-agent-linux-x64" ]]; then
    SRC="$SCRIPT_DIR/oesf-lpr-agent-linux-x64"
  else
    echo "Usage: $0 [path/to/oesf-lpr-agent]" >&2
    exit 1
  fi
fi

if [[ ! -f "$SRC" ]]; then
  echo "Binary not found: $SRC" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$DATA_DIR" "$UNIT_DIR"

install -m 755 "$SRC" "$BIN_DIR/oesf-lpr-agent"

if [[ -f "$SCRIPT_DIR/config.example.yaml" && ! -f "$DATA_DIR/config.yaml" ]]; then
  cp "$SCRIPT_DIR/config.example.yaml" "$DATA_DIR/config.yaml"
fi

UNIT="$UNIT_DIR/oesf-lpr-agent.service"
cat > "$UNIT" <<EOF
[Unit]
Description=OESF LPR Site Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${BIN_DIR}/oesf-lpr-agent
Environment=OESF_LPR_AGENT_DATA=${DATA_DIR}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

echo "Installed: $BIN_DIR/oesf-lpr-agent"
echo "Data dir:  $DATA_DIR"
echo "Unit:      $UNIT"
echo
echo "Enable and start (user systemd):"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable --now oesf-lpr-agent"
echo
echo "Then open http://127.0.0.1:8787 to pair."
echo "Or run once in the foreground: oesf-lpr-agent"
