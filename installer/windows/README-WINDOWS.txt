OESF LPR Site Agent — Windows

Install (recommended)
  Run oesf-lpr-agent-*-setup-win-x64.exe
  The agent starts in the background (no console window) and opens
  http://127.0.0.1:8787 for pairing.

Portable
  Run oesf-lpr-agent.exe — it re-launches hidden and exits the console.
  To keep a console for debugging: oesf-lpr-agent.exe --foreground

  Config, pairing state, and logs:
    %LOCALAPPDATA%\OESF\LPR Agent\
    agent.log  — runtime log when running in the background

The agent must keep running to sync plates. You do not need a visible
window; end the oesf-lpr-agent.exe process in Task Manager to stop it.

Pairing
  1. Open the local UI (http://127.0.0.1:8787)
  2. Enter your OESF API URL if prompted
  3. Note the pairing code
  4. In the portal: Admin → Cameras → Sites → Claim with code
  5. Map each camera’s LAN address and credentials in the local UI

Optional env
  OESF_LPR_AGENT_DATA          override data directory
  OESF_LPR_AGENT_CONFIG        override config.yaml path
  OESF_LPR_AGENT_PORT          local UI port (default 8787)
  OESF_LPR_AGENT_FOREGROUND=1  keep console (same as --foreground)
