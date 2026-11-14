import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

export const DEFAULT_UPDATE_REPO = 'EmileSpecs/oesf-lpr-agent'

/** @returns {-1|0|1} */
export function compareSemver (a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

function platformAssetName () {
  if (process.platform === 'win32') return 'oesf-lpr-agent-win-x64.exe'
  if (process.platform === 'linux' && process.arch === 'x64') return 'oesf-lpr-agent-linux-x64'
  return null
}

async function fetchJson (url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'oesf-lpr-agent'
    }
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function downloadToFile (url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'oesf-lpr-agent', Accept: 'application/octet-stream' },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`download failed HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath))
}

async function sha256File (path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function parseSha256Sums (text) {
  const map = new Map()
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (m) map.set(m[2].trim().replace(/^\.\//, ''), m[1].toLowerCase())
  }
  return map
}

function writeWindowsReplaceScript ({ scriptPath, exePath, newPath, pid }) {
  const content = `@echo off
setlocal
:wait
tasklist /FI "PID eq ${pid}" 2>NUL | find "${pid}" >NUL
if not errorlevel 1 (
  timeout /t 1 /nobreak >NUL
  goto wait
)
move /Y "${newPath}" "${exePath}" >NUL
start "" /B "${exePath}" --no-open
del "%~f0"
`
  writeFileSync(scriptPath, content, 'utf8')
}

function writeLinuxReplaceScript ({ scriptPath, exePath, newPath, pid }) {
  const content = `#!/bin/sh
set -e
while kill -0 ${pid} 2>/dev/null; do sleep 1; done
mv -f "${newPath}" "${exePath}"
chmod +x "${exePath}"
if systemctl --user is-active --quiet oesf-lpr-agent 2>/dev/null; then
  systemctl --user restart oesf-lpr-agent
else
  nohup "${exePath}" --no-open >/dev/null 2>&1 &
fi
rm -f "${scriptPath}"
`
  writeFileSync(scriptPath, content, 'utf8')
  chmodSync(scriptPath, 0o755)
}

/**
 * Check GitHub Releases for a newer version and apply it (replace binary + restart).
 * @returns {{ status: string, current: string, latest?: string, error?: string }}
 */
export async function checkAndApplyUpdate ({
  currentVersion,
  repo = DEFAULT_UPDATE_REPO,
  log = console,
  apply = true
}) {
  const assetName = platformAssetName()
  if (!assetName) {
    return { status: 'unsupported_platform', current: currentVersion }
  }

  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`)
  const latestTag = String(release.tag_name || '').replace(/^v/i, '')
  if (!latestTag) throw new Error('latest release has no tag_name')

  if (compareSemver(latestTag, currentVersion) <= 0) {
    return { status: 'up_to_date', current: currentVersion, latest: latestTag }
  }

  const assets = release.assets || []
  const asset = assets.find((a) => a.name === assetName)
  if (!asset?.browser_download_url) {
    throw new Error(`release asset not found: ${assetName}`)
  }
  const sumsAsset = assets.find((a) => a.name === 'SHA256SUMS.txt')
  if (!sumsAsset?.browser_download_url) {
    throw new Error('SHA256SUMS.txt missing from release')
  }

  if (!apply) {
    return { status: 'update_available', current: currentVersion, latest: latestTag }
  }

  const exePath = process.execPath
  const dir = dirname(exePath)
  const newPath = join(dir, `${assetName}.new`)
  const sumsPath = join(dir, 'SHA256SUMS.txt.new')

  log.info?.(`update: downloading ${assetName} (${latestTag})`)
  await downloadToFile(asset.browser_download_url, newPath)
  await downloadToFile(sumsAsset.browser_download_url, sumsPath)

  const sumsText = readFileSync(sumsPath, 'utf8')
  const expected = parseSha256Sums(sumsText).get(assetName)
  if (!expected) throw new Error(`no SHA256 entry for ${assetName}`)
  const actual = await sha256File(newPath)
  if (actual !== expected) {
    throw new Error(`SHA256 mismatch for ${assetName}`)
  }

  if (process.platform !== 'win32') {
    chmodSync(newPath, 0o755)
  }

  const pid = process.pid
  if (process.platform === 'win32') {
    const scriptPath = join(dir, 'oesf-lpr-agent-update.cmd')
    writeWindowsReplaceScript({ scriptPath, exePath, newPath, pid })
    spawn(scriptPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OESF_LPR_AGENT_HIDDEN: '1', OESF_LPR_AGENT_NO_OPEN: '1' }
    }).unref()
  } else {
    const scriptPath = join(dir, 'oesf-lpr-agent-update.sh')
    writeLinuxReplaceScript({ scriptPath, exePath, newPath, pid })
    spawn(scriptPath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, OESF_LPR_AGENT_HIDDEN: '1', OESF_LPR_AGENT_NO_OPEN: '1' }
    }).unref()
  }

  log.info?.(`update: applying ${latestTag}, restarting…`)
  return { status: 'updating', current: currentVersion, latest: latestTag, restarting: true }
}

export function updatesEnabled (config = {}) {
  if (process.env.OESF_LPR_AGENT_NO_UPDATE === '1') return false
  if (config.check_updates === false) return false
  return true
}

export function updateRepoFromConfig (config = {}) {
  const fromEnv = process.env.OESF_LPR_AGENT_UPDATE_REPO
  if (fromEnv) return String(fromEnv).trim()
  if (config.update_repo) return String(config.update_repo).trim()
  return DEFAULT_UPDATE_REPO
}
