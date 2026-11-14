OESF LPR Site Agent — Linux (x86_64)

Quick install
  tar -xzf oesf-lpr-agent-*-linux-x64.tar.gz
  cd <extracted-folder>
  chmod +x oesf-lpr-agent install.sh
  ./install.sh

  systemctl --user daemon-reload
  systemctl --user enable --now oesf-lpr-agent

  Open http://127.0.0.1:8787

Portable (no install)
  chmod +x oesf-lpr-agent
  ./oesf-lpr-agent

  Config and pairing state default to:
    ~/.local/share/oesf-lpr-agent/

Pairing
  1. Open the local UI
  2. Enter your OESF API URL if prompted
  3. Note the pairing code
  4. Portal: Admin → Cameras → Sites → Claim with code
  5. Map camera LAN credentials in the local UI

Optional env
  OESF_LPR_AGENT_DATA     override data directory
  OESF_LPR_AGENT_CONFIG   override config.yaml path
  OESF_LPR_AGENT_PORT     local UI port (default 8787)
  OESF_LPR_AGENT_PREFIX   install prefix for install.sh (default /usr/local)
