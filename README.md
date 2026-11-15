# oesf-lpr-agent

LAN site agent that pairs with OESF, caches the vehicle plate list in memory, accepts Hikvision Alarm Server POSTs, and forwards **only matching plates** (plus heartbeats) to the cloud webhook.

**Public repo:** [github.com/EmileSpecs/oesf-lpr-agent](https://github.com/EmileSpecs/oesf-lpr-agent)  
**Releases:** [Releases](https://github.com/EmileSpecs/oesf-lpr-agent/releases)

## Install (recommended)

Download the latest release assets (Windows setup / portable zip, or Linux tarball).

### Windows

1. Run `oesf-lpr-agent-*-setup-win-x64.exe` (or extract the portable zip and run `oesf-lpr-agent.exe`).
2. The agent starts **in the background** (no console), shows a **system tray** icon, and opens **http://127.0.0.1:8787**.
3. Pair in the portal (below).

Config, state, and `agent.log` live in `%LOCALAPPDATA%\OESF\LPR Agent\`.

**Tray menu (right-click the icon in the notification area):** Open agent UI · Restart agent · Quit.

Use `--foreground` to keep a console for debugging. Disable the tray with `--no-tray` or `OESF_LPR_AGENT_NO_TRAY=1`.

### Linux (x86_64)

```bash
tar -xzf oesf-lpr-agent-*-linux-x64.tar.gz
cd <extracted-folder>
chmod +x oesf-lpr-agent install.sh
./install.sh
systemctl --user daemon-reload
systemctl --user enable --now oesf-lpr-agent
```

Open **http://127.0.0.1:8787**. Data defaults to `~/.local/share/oesf-lpr-agent/`.

## Auto-update

Packaged installs check [GitHub Releases](https://github.com/EmileSpecs/oesf-lpr-agent/releases) shortly after start and every 6 hours. If a newer version is published, the agent downloads the platform binary, verifies `SHA256SUMS.txt`, replaces itself, and restarts. Pairing state is preserved.

Disable with:

- `OESF_LPR_AGENT_NO_UPDATE=1`, or
- `check_updates: false` in `config.yaml`

Source/`npm start` builds do not auto-update.

## Publishing a release

1. Bump `"version"` in `package.json` (e.g. `0.4.1`).
2. Commit and push to `main`.
3. Tag and push: `git tag v0.4.1 && git push origin v0.4.1`
4. GitHub Actions builds Windows + Linux binaries, attaches them to the Release (tag must match `package.json` version).

Installed agents pick up the new release automatically.

## Pairing & filter mode

1. Open the local UI and set the OESF API URL if needed — a **pairing code** appears.
2. Portal: **Admin → Cameras → Sites → Claim with code**.
3. Attach cameras to the site in the portal (sync mode **Site**).
4. In the agent UI, copy each camera’s **LAN Alarm Server URL**.
5. On each camera: Alarm Server → that LAN URL (not the cloud webhook).

The agent refreshes the plate list from OESF on an interval, keeps it in memory, drops non-matching ANPR events, and forwards matches to `{api}/camera/lpr/{webhook_id}`.

Optional legacy ISAPI blacklist push: set `push_blacklist_to_cameras: true` in `config.yaml`.

## LAN camera discovery

The local UI includes **Discover cameras**:

1. **SADP** — Hikvision multicast inquiry (`239.255.255.250:37020`) for model, serial, IP, HTTP port.
2. **Subnet scan** (optional) — probes the agent’s `/24` for `/ISAPI/System/deviceInfo` on ports 80 and 8000 when multicast is blocked.

Use discovered IPs when setting each camera’s Alarm Server to this agent’s LAN webhook URL.

## Develop from source

```bash
cp config.example.yaml config.yaml
npm install
npm start
```

## Build installers (local)

Requires Node 20+. Windows setup.exe also needs [Inno Setup 6](https://jrsoftware.org/isinfo.php).

```bash
npm install
npm run build                 # binaries + portable zip/tar in dist/
npm run build:installer       # Windows setup.exe (ISCC)
```

| Artifact | Path |
|----------|------|
| Windows setup | `dist/oesf-lpr-agent-<ver>-setup-win-x64.exe` |
| Windows portable | `dist/oesf-lpr-agent-<ver>-win-x64.zip` |
| Linux portable | `dist/oesf-lpr-agent-<ver>-linux-x64.tar.gz` |
| Raw binaries | `dist/bin/oesf-lpr-agent-*-x64*` |

## Docker

```bash
docker build -t oesf-lpr-agent .
docker run --rm -p 8787:8787 -v "$PWD/data:/app/data" \
  -e OESF_LPR_AGENT_CONFIG=/app/data/config.yaml \
  oesf-lpr-agent
```

## Security

- Camera admin passwords stay in `state.json` on site (legacy ISAPI mapping only).
- The portal API key for the agent is delivered once after claim and is not listed under Admin → API keys as a copyable secret.
- Release binaries are verified by SHA-256 before auto-update replaces the executable.
