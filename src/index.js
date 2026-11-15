#!/usr/bin/env node
import { createServer } from 'node:http'
import { appendFileSync, createWriteStream, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { hostname as osHostname, networkInterfaces } from 'node:os'
import { exec, spawn } from 'node:child_process'
import yaml from 'js-yaml'
import { createOesfClient } from './oesf.js'
import { loadState, saveState, statePath as resolveStatePath } from './state.js'
import { syncPlateList } from './sync.js'
import { createPlateStore } from './plates.js'
import { classifyLprBody, decideForward, readRawBody } from './ingestFilter.js'
import { discoverCameras } from './discover.js'
import { defaultConfigPath, ensureDataDir, isPackaged } from './paths.js'
import {
  checkAndApplyUpdate,
  updateRepoFromConfig,
  updatesEnabled
} from './update.js'
import { startTray, trayEnabledByDefault } from './tray.js'

const VERSION = globalThis.__OESF_AGENT_VERSION__ || '0.4.1'

function usage () {
  console.log(`oesf-lpr-agent — pair with OESF and push plate blacklists to Hikvision cameras

Usage:
  oesf-lpr-agent [--config path] [--port 8787] [--once] [--no-open] [--foreground] [--no-tray]

Env:
  OESF_LPR_AGENT_CONFIG   config file (default: data dir / config.yaml)
  OESF_LPR_AGENT_DATA     data directory for config + state (packaged default)
  OESF_LPR_AGENT_PORT     local UI port (default 8787)
  OESF_API_URL            optional default API base
  OESF_LPR_AGENT_NO_UPDATE=1  disable GitHub auto-update
  OESF_LPR_AGENT_NO_TRAY=1    disable system tray icon
  OESF_LPR_AGENT_TRAY=1       enable tray when running from source

Windows packaged builds run in the background by default (no console) with a tray icon.
Use --foreground to keep the console window open for debugging.
`)
}

function parseArgs (argv) {
  const args = {
    once: false,
    help: false,
    noOpen: false,
    foreground: false,
    noTray: false,
    config: process.env.OESF_LPR_AGENT_CONFIG || null,
    port: Number(process.env.OESF_LPR_AGENT_PORT) || 8787
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--once') args.once = true
    else if (a === '--help' || a === '-h') args.help = true
    else if (a === '--no-open') args.noOpen = true
    else if (a === '--foreground') args.foreground = true
    else if (a === '--no-tray') args.noTray = true
    else if (a === '--config') args.config = argv[++i]
    else if (a.startsWith('--config=')) args.config = a.slice('--config='.length)
    else if (a === '--port') args.port = Number(argv[++i]) || args.port
  }
  return args
}

function restartAgentProcess () {
  const childEnv = {
    ...process.env,
    OESF_LPR_AGENT_HIDDEN: '1',
    OESF_LPR_AGENT_NO_OPEN: '1'
  }
  spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.cwd(),
    env: childEnv
  }).unref()
}

/** Packaged Windows: re-launch hidden so the user does not need a console window. */
function backgroundSelfOnWindows (args) {
  if (process.platform !== 'win32') return false
  if (!isPackaged()) return false
  if (args.once || args.help || args.foreground) return false
  if (process.env.OESF_LPR_AGENT_FOREGROUND === '1') return false
  if (process.env.OESF_LPR_AGENT_HIDDEN === '1') return false

  spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, OESF_LPR_AGENT_HIDDEN: '1' }
  }).unref()
  return true
}

function attachFileLog () {
  if (process.env.OESF_LPR_AGENT_HIDDEN !== '1' && !isPackaged()) return
  try {
    const dir = ensureDataDir()
    const logPath = join(dir, 'agent.log')
    const stream = createWriteStream(logPath, { flags: 'a' })
    const write = (chunk) => {
      try {
        stream.write(chunk)
      } catch {
        /* ignore */
      }
    }
    const wrap = (fn) => (...a) => {
      fn(...a)
      write(`${a.map(String).join(' ')}\n`)
    }
    console.log = wrap(console.log.bind(console))
    console.warn = wrap(console.warn.bind(console))
    console.error = wrap(console.error.bind(console))
    appendFileSync(logPath, `\n--- start ${new Date().toISOString()} pid=${process.pid} ---\n`)
  } catch {
    /* ignore */
  }
}

function logoDataUrl () {
  if (typeof globalThis.__OESF_LOGO_DATA_URL__ === 'string' && globalThis.__OESF_LOGO_DATA_URL__) {
    return globalThis.__OESF_LOGO_DATA_URL__
  }
  const candidates = [
    resolve(process.cwd(), 'assets', 'logo.png'),
    resolve(process.cwd(), 'logo.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      return `data:image/png;base64,${readFileSync(p).toString('base64')}`
    }
  }
  return '/logo.png'
}

function loadUiHtml () {
  let html
  if (typeof globalThis.__OESF_UI_HTML__ === 'string') {
    html = globalThis.__OESF_UI_HTML__
  } else {
    const candidates = [
      resolve(process.cwd(), 'src', 'ui.html'),
      resolve(process.cwd(), 'ui.html')
    ]
    const path = candidates.find((p) => existsSync(p))
    if (!path) throw new Error('ui.html not found (run from the agent package root, or use a packaged build)')
    html = readFileSync(path, 'utf8')
  }
  return html.replaceAll('{{LOGO_SRC}}', logoDataUrl())
}

function loadLogoPng () {
  const candidates = [
    resolve(process.cwd(), 'assets', 'logo.png'),
    resolve(process.cwd(), 'logo.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p)
  }
  return null
}

function openBrowser (url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`
  exec(cmd, () => {})
}

function loadConfigFile (path) {
  if (!existsSync(path)) {
    return {
      oesf: { api: process.env.OESF_API_URL || '' },
      poll_interval_seconds: 120,
      ui_port: undefined,
      push_blacklist_to_cameras: false,
      check_updates: true,
      update_repo: undefined
    }
  }
  const raw = yaml.load(readFileSync(path, 'utf8')) || {}
  return {
    oesf: raw.oesf || {},
    poll_interval_seconds: Number(raw.poll_interval_seconds) > 0 ? Number(raw.poll_interval_seconds) : 120,
    ui_port: raw.ui_port,
    // Default false: agent filters events in memory instead of pushing blacklists to cameras
    push_blacklist_to_cameras: raw.push_blacklist_to_cameras === true,
    check_updates: raw.check_updates !== false,
    update_repo: raw.update_repo
  }
}

function lanAddresses () {
  const out = []
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const info of list || []) {
      if (info.internal) continue
      const fam = info.family
      if (fam !== 'IPv4' && fam !== 4) continue
      out.push(info.address)
    }
  }
  return out
}

function log (...args) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}
const logger = {
  info: (...a) => log(...a),
  warn: (...a) => console.warn(`[${new Date().toISOString()}]`, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}]`, ...a)
}

function readJson (req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolvePromise(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function send (res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json)
  })
  res.end(json)
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    process.exit(0)
  }

  if (backgroundSelfOnWindows(args)) {
    process.exit(0)
  }

  ensureDataDir()
  attachFileLog()

  const configPath = args.config
    ? resolve(process.cwd(), args.config)
    : defaultConfigPath()
  const config = loadConfigFile(configPath)
  const stateFile = resolveStatePath(configPath)
  let state = loadState(stateFile)
  log(`data: ${dirname(stateFile)}`)

  if (!state.api_url && config.oesf.api) {
    state.api_url = String(config.oesf.api).replace(/\/$/, '')
    saveState(stateFile, state)
  }
  // Legacy: api_key in yaml
  if (!state.api_key && config.oesf.api_key) {
    state.api_key = config.oesf.api_key
    state.status = 'claimed'
    saveState(stateFile, state)
  }

  const port = Number(config.ui_port) || args.port
  const plateStore = createPlateStore()
  const syncOpts = { pushToCameras: config.push_blacklist_to_cameras }
  const filterStats = { forwarded: 0, dropped: 0, last_plate: null, last_at: null }
  const updateStatus = {
    enabled: updatesEnabled(config) && isPackaged(),
    current: VERSION,
    latest: null,
    status: isPackaged() ? 'pending' : 'dev',
    checked_at: null,
    error: null
  }
  let trayHandle = null

  async function runUpdateCheck () {
    if (!updatesEnabled(config) || !isPackaged()) {
      updateStatus.status = isPackaged() ? 'disabled' : 'dev'
      return
    }
    try {
      const result = await checkAndApplyUpdate({
        currentVersion: VERSION,
        repo: updateRepoFromConfig(config),
        log: logger,
        apply: true
      })
      updateStatus.status = result.status
      updateStatus.latest = result.latest || null
      updateStatus.checked_at = new Date().toISOString()
      updateStatus.error = null
      if (result.restarting) {
        try {
          trayHandle?.kill()
        } catch {
          /* ignore */
        }
        // Give the replace script a moment to spawn, then exit so the file unlocks
        setTimeout(() => process.exit(0), 500)
      }
    } catch (error) {
      updateStatus.status = 'error'
      updateStatus.error = error.message || String(error)
      updateStatus.checked_at = new Date().toISOString()
      logger.warn(`update check: ${updateStatus.error}`)
    }
  }

  function clientFromState () {
    if (!state.api_url) throw new Error('Set OESF API URL first')
    return createOesfClient({
      api: state.api_url,
      apiKey: state.api_key || undefined,
      deviceToken: state.device_token || undefined
    })
  }

  function allowedWebhookIds () {
    const set = new Set()
    for (const cam of state.assigned_cameras || []) {
      if (cam.webhook_id) set.add(String(cam.webhook_id))
    }
    return set
  }

  function ingestUrlsFor (webhookId) {
    const path = `/camera/lpr/${webhookId}`
    const urls = [`http://127.0.0.1:${port}${path}`]
    for (const ip of lanAddresses()) urls.push(`http://${ip}:${port}${path}`)
    return urls
  }

  async function runPlateSync () {
    return syncPlateList(clientFromState(), state, plateStore, logger, syncOpts)
  }

  async function handleCameraIngest (req, res, webhookId) {
    const allowed = allowedWebhookIds()
    if (allowed.size && !allowed.has(webhookId)) {
      send(res, 404, { ok: false, error: 'unknown_camera' })
      return
    }

    const raw = await readRawBody(req)
    const contentType = req.headers['content-type'] || ''
    const classification = classifyLprBody(contentType, raw)
    const decision = decideForward(classification, plateStore)

    if (decision.action === 'drop') {
      filterStats.dropped += 1
      filterStats.last_plate = decision.plate || null
      filterStats.last_at = new Date().toISOString()
      logger.info(`filter drop ${decision.reason}${decision.plate ? ` plate=${decision.plate}` : ''}`)
      send(res, 200, { ok: true, handled: 'filtered_local', reason: decision.reason })
      return
    }

    if (!state.api_url) {
      send(res, 503, { ok: false, error: 'api_url_not_configured' })
      return
    }

    const cloudUrl = `${String(state.api_url).replace(/\/$/, '')}/camera/lpr/${webhookId}`
    try {
      const headers = { 'Content-Type': contentType }
      if (req.headers['content-length']) headers['Content-Length'] = String(raw.length)
      const upstream = await fetch(cloudUrl, { method: 'POST', headers, body: raw })
      const text = await upstream.text().catch(() => '')
      filterStats.forwarded += 1
      filterStats.last_plate = decision.plate || null
      filterStats.last_at = new Date().toISOString()
      logger.info(
        `filter forward ${decision.reason}${decision.plate ? ` plate=${decision.plate}` : ''} → ${upstream.status}`
      )
      // Always ack the camera; log upstream problems without causing retry storms
      if (!upstream.ok) {
        logger.warn(`cloud webhook ${upstream.status}: ${text.slice(0, 200)}`)
      }
      send(res, 200, {
        ok: true,
        handled: 'forwarded',
        reason: decision.reason,
        cloud_status: upstream.status
      })
    } catch (error) {
      logger.error(`forward failed: ${error.message}`)
      send(res, 200, { ok: false, handled: 'forward_error', error: error.message })
    }
  }

  async function announce () {
    const client = createOesfClient({ api: state.api_url })
    const result = await client.announce({
      hostname: osHostname(),
      agent_version: VERSION,
      resume_id: state.site_agent_id || undefined,
      meta: { platform: process.platform }
    })
    state.site_agent_id = result.body.id
    state.pairing_code = result.body.pairing_code
    state.device_token = result.body.device_token
    state.pairing_expires_at = result.body.pairing_expires_at
    state.status = result.body.status || 'pending'
    state.api_key = null
    saveState(stateFile, state)
    log(`announced — pairing code ${state.pairing_code}`)
  }

  async function pollStatus () {
    if (!state.device_token || state.api_key) return
    const client = createOesfClient({
      api: state.api_url,
      deviceToken: state.device_token
    })
    const result = await client.status()
    const body = result.body || {}
    state.status = body.status || state.status
    state.name = body.name || state.name
    if (body.pairing_code) state.pairing_code = body.pairing_code
    if (body.pairing_expires_at) state.pairing_expires_at = body.pairing_expires_at
    if (body.api_key) {
      state.api_key = body.api_key
      state.status = 'claimed'
      log('claimed — API key received and stored locally')
    }
    if (body.pairing_expired) {
      log('pairing code expired — re-announcing')
      await announce()
      return
    }
    saveState(stateFile, state)
  }

  async function refreshAssigned () {
    if (!state.api_key) {
      state.assigned_cameras = []
      return
    }
    const client = clientFromState()
    const listed = await client.listCameras()
    state.assigned_cameras = listed.body?.data || []
    saveState(stateFile, state)
  }

  async function ensurePaired () {
    if (!state.api_url) return
    if (state.api_key) {
      state.status = 'claimed'
      return
    }
    if (!state.device_token || !state.site_agent_id) {
      await announce()
    } else {
      await pollStatus()
    }
  }

  const uiHtml = loadUiHtml()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(uiHtml)
        return
      }

      if (req.method === 'GET' && url.pathname === '/logo.png') {
        const png = loadLogoPng()
        if (!png) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
        res.end(png)
        return
      }

      if (req.method === 'GET' && url.pathname === '/local/state') {
        if (state.api_key) {
          try {
            await refreshAssigned()
          } catch (e) {
            logger.warn(e.message)
          }
        } else if (state.api_url) {
          try {
            await pollStatus()
          } catch (e) {
            logger.warn(e.message)
          }
        }
        const assigned = (state.assigned_cameras || []).map((cam) => ({
          ...cam,
          ingest_urls: cam.webhook_id ? ingestUrlsFor(cam.webhook_id) : []
        }))
        send(res, 200, {
          api_url: state.api_url,
          status: state.status,
          pairing_code: state.pairing_code,
          pairing_expires_at: state.pairing_expires_at,
          site_agent_id: state.site_agent_id,
          name: state.name,
          api_key: state.api_key ? true : false,
          cameras: state.cameras,
          assigned_cameras: assigned,
          plate_cache: plateStore.snapshot(),
          filter_stats: filterStats,
          push_blacklist_to_cameras: config.push_blacklist_to_cameras,
          listen_port: port,
          lan_addresses: lanAddresses(),
          version: VERSION,
          update: updateStatus
        })
        return
      }

      const ingestMatch = url.pathname.match(/^\/camera\/lpr\/([A-Za-z0-9]{12})$/)
      if (req.method === 'POST' && ingestMatch) {
        await handleCameraIngest(req, res, ingestMatch[1])
        return
      }

      if (req.method === 'POST' && url.pathname === '/local/config') {
        const body = await readJson(req)
        state.api_url = String(body.api_url || '').replace(/\/$/, '')
        if (!state.api_url) throw new Error('api_url required')
        saveState(stateFile, state)
        state.api_key = null
        state.device_token = null
        state.site_agent_id = null
        await announce()
        send(res, 200, { ok: true, pairing_code: state.pairing_code })
        return
      }

      if (req.method === 'PUT' && url.pathname.startsWith('/local/cameras/')) {
        const id = url.pathname.slice('/local/cameras/'.length)
        const body = await readJson(req)
        state.cameras = state.cameras || {}
        state.cameras[id] = {
          host: String(body.host || '').trim(),
          port: body.port === '' || body.port == null ? undefined : Number(body.port),
          user: String(body.user || '').trim(),
          password: body.password == null ? '' : String(body.password),
          channel: body.channel == null || body.channel === '' ? 1 : Number(body.channel),
          use_https: !!body.use_https
        }
        saveState(stateFile, state)
        send(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && url.pathname === '/local/sync') {
        if (!state.api_key) throw new Error('Not claimed yet')
        const result = await runPlateSync()
        saveState(stateFile, state)
        send(res, 200, {
          ok: true,
          message: `Plate cache ${result.changed ? 'updated' : 'unchanged'} (${result.count} plates)`,
          ...result
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/local/discover') {
        const body = await readJson(req).catch(() => ({}))
        const timeoutMs = Number(body.timeout_ms) > 0 ? Number(body.timeout_ms) : 3000
        const scanSubnet = body.scan_subnet !== false
        logger.info(`discover: SADP${scanSubnet ? ' + subnet ISAPI scan' : ''}…`)
        const devices = await discoverCameras({ timeoutMs, scanSubnet })
        logger.info(`discover: found ${devices.length} device(s)`)
        send(res, 200, { ok: true, count: devices.length, devices })
        return
      }

      send(res, 404, { error: 'not_found' })
    } catch (error) {
      send(res, 400, { error: error.message || String(error) })
    }
  })

  await new Promise((resolveListen) => {
    server.listen(port, '0.0.0.0', () => {
      log(`local UI http://127.0.0.1:${port}/`)
      resolveListen()
    })
  })

  const shouldOpen = !args.once && !args.noOpen && process.env.OESF_LPR_AGENT_NO_OPEN !== '1'
  if (shouldOpen && (isPackaged() || process.env.OESF_LPR_AGENT_OPEN === '1')) {
    openBrowser(`http://127.0.0.1:${port}/`)
  }

  try {
    await ensurePaired()
  } catch (e) {
    logger.warn(`pairing bootstrap: ${e.message}`)
  }

  if (state.api_key) {
    try {
      await runPlateSync()
      saveState(stateFile, state)
    } catch (e) {
      logger.warn(`initial plate sync: ${e.message}`)
    }
  }

  if (args.once) {
    process.exit(0)
  }

  const pollMs = config.poll_interval_seconds * 1000
  setInterval(() => {
    ;(async () => {
      try {
        if (!state.api_key) {
          await ensurePaired()
          return
        }
        await runPlateSync()
        saveState(stateFile, state)
      } catch (e) {
        logger.error(e.message)
      }
    })()
  }, pollMs)

  log(`polling every ${config.poll_interval_seconds}s (filter mode${config.push_blacklist_to_cameras ? ' + ISAPI push' : ''})`)
  log(`camera Alarm Server → http://<this-host>:${port}/camera/lpr/<webhook_id>`)
  log(`version ${VERSION}`)

  const wantTray = !args.once && !args.noTray && trayEnabledByDefault()
  if (wantTray) {
    try {
      trayHandle = await startTray({
        port,
        log: logger,
        openUi: () => openBrowser(`http://127.0.0.1:${port}/`),
        restart: () => {
          logger.info('tray: restart requested')
          try {
            trayHandle?.kill()
          } catch {
            /* ignore */
          }
          restartAgentProcess()
          setTimeout(() => process.exit(0), 250)
        },
        quit: () => {
          logger.info('tray: quit requested')
          try {
            trayHandle?.kill()
          } catch {
            /* ignore */
          }
          setTimeout(() => process.exit(0), 100)
        }
      })
    } catch (e) {
      logger.warn(`tray: ${e.message || e}`)
    }
  }

  // Auto-update: first check after settle, then every 6 hours
  if (updatesEnabled(config) && isPackaged()) {
    setTimeout(() => {
      runUpdateCheck().catch(() => {})
    }, 15_000)
    setInterval(() => {
      runUpdateCheck().catch(() => {})
    }, 6 * 60 * 60 * 1000)
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
