/**
 * Windows (and Linux) system tray via systray-portable helper shipped beside the agent.
 * Menu: Open UI · Restart · Quit
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { ensureDataDir, isPackaged } from './paths.js'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

function helperName () {
  if (process.platform === 'win32') return 'tray_windows_release.exe'
  if (process.platform === 'linux') return 'tray_linux_release'
  if (process.platform === 'darwin') return 'tray_darwin_release'
  return null
}

function candidateHelperPaths (name) {
  const paths = []
  // pkg snapshot / esbuild stage (read-only — we copy out before spawn)
  paths.push(join(here, 'traybin', name))
  // Next to packaged exe (installer / portable zip)
  paths.push(join(dirname(process.execPath), 'traybin', name))
  // Data dir cache (copied on first run)
  paths.push(join(ensureDataDir(), 'traybin', name))
  // Dev / cwd
  paths.push(join(process.cwd(), 'traybin', name))
  paths.push(join(process.cwd(), 'node_modules', 'systray2', 'traybin', name))
  paths.push(join(here, '..', 'node_modules', 'systray2', 'traybin', name))
  paths.push(join(here, '..', 'vendor', 'traybin', name))
  try {
    const pkgJson = require.resolve('systray2/package.json')
    paths.push(join(dirname(pkgJson), 'traybin', name))
  } catch {
    /* optional */
  }
  return paths
}

/**
 * Ensure helper exists on a real filesystem path (pkg snapshot is not executable).
 * Prefer the writable data dir copy.
 */
export function resolveTrayHelper () {
  const name = helperName()
  if (!name) return null
  const cached = join(ensureDataDir(), 'traybin', name)
  if (existsSync(cached)) return cached
  for (const src of candidateHelperPaths(name)) {
    if (!existsSync(src) || src === cached) continue
    try {
      mkdirSync(dirname(cached), { recursive: true })
      cpSync(src, cached)
      return cached
    } catch {
      // Last resort: spawn from a real path next to the exe (not from snapshot)
      if (!src.includes('snapshot') && existsSync(src)) return src
    }
  }
  return null
}

function loadTrayIconBase64 () {
  // Prefer dedicated tray badge (.ico on Windows, .png elsewhere). Never use the
  // full marketing logo — at 16px it turns into an unreadable blob/star.
  const candidates = [
    join(dirname(process.execPath), 'tray.ico'),
    join(dirname(process.execPath), 'tray.png'),
    join(ensureDataDir(), 'tray.ico'),
    join(ensureDataDir(), 'tray.png'),
    join(process.cwd(), 'assets', 'tray.ico'),
    join(process.cwd(), 'assets', 'tray.png'),
    join(here, '..', 'assets', 'tray.ico'),
    join(here, '..', 'assets', 'tray.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p).toString('base64')
  }
  if (typeof globalThis.__OESF_TRAY_ICON_B64__ === 'string' && globalThis.__OESF_TRAY_ICON_B64__) {
    return globalThis.__OESF_TRAY_ICON_B64__
  }
  return ''
}

function menuItem (title, id, opts = {}) {
  return {
    title,
    tooltip: opts.tooltip || title,
    checked: false,
    enabled: opts.enabled !== false,
    hidden: !!opts.hidden,
    __id: id
  }
}

/**
 * @param {{
 *   port: number
 *   openUi: () => void
 *   restart: () => void
 *   quit: () => void
 *   log?: { info?: Function, warn?: Function }
 * }} opts
 * @returns {Promise<{ kill: () => void } | null>}
 */
export async function startTray (opts) {
  if (process.env.OESF_LPR_AGENT_NO_TRAY === '1') return null
  if (process.platform !== 'win32' && process.platform !== 'linux') return null

  const helper = resolveTrayHelper()
  if (!helper) {
    opts.log?.warn?.('tray: helper binary not found — tray icon disabled')
    return null
  }

  const icon = loadTrayIconBase64()
  const ID_OPEN = 1
  const ID_RESTART = 2
  const ID_QUIT = 3
  const menu = {
    icon,
    title: 'OESF LPR',
    tooltip: 'OESF LPR Site Agent',
    items: [
      menuItem('Open agent UI', ID_OPEN, { tooltip: `http://127.0.0.1:${opts.port}/` }),
      menuItem('Restart agent', ID_RESTART),
      { title: '<SEPARATOR>', tooltip: '', checked: false, enabled: true, __id: 100 },
      menuItem('Quit', ID_QUIT)
    ]
  }

  let child
  try {
    child = spawn(helper, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (e) {
    opts.log?.warn?.(`tray: failed to start helper: ${e.message}`)
    return null
  }

  const rl = createInterface({ input: child.stdout })
  let ready = false

  const writeMenu = () => {
    try {
      child.stdin.write(`${JSON.stringify(menu)}\n`)
    } catch {
      /* ignore */
    }
  }

  const kill = () => {
    try {
      rl.close()
    } catch {
      /* ignore */
    }
    try {
      if (child && !child.killed) child.kill()
    } catch {
      /* ignore */
    }
  }

  child.on('error', (err) => {
    opts.log?.warn?.(`tray: ${err.message}`)
  })
  child.stderr?.on('data', () => {
    /* ignore helper noise */
  })

  await new Promise((resolveReady) => {
    const timer = setTimeout(() => {
      if (!ready) {
        opts.log?.warn?.('tray: helper did not become ready')
        kill()
        resolveReady(null)
      }
    }, 8000)

    rl.on('line', (line) => {
      let action
      try {
        action = JSON.parse(line)
      } catch {
        return
      }
      if (action.type === 'ready') {
        ready = true
        clearTimeout(timer)
        writeMenu()
        opts.log?.info?.('tray: icon ready')
        resolveReady(true)
        return
      }
      if (action.type === 'clicked') {
        const id = action.__id
        if (id === ID_OPEN) opts.openUi()
        else if (id === ID_RESTART) opts.restart()
        else if (id === ID_QUIT) opts.quit()
      }
    })

    child.on('exit', () => {
      clearTimeout(timer)
      if (!ready) resolveReady(null)
    })
  })

  if (!ready) return null
  return { kill }
}

export function trayEnabledByDefault () {
  if (process.env.OESF_LPR_AGENT_NO_TRAY === '1') return false
  // Source runs: allow tray when explicitly requested or packaged
  if (isPackaged()) return true
  return process.env.OESF_LPR_AGENT_TRAY === '1'
}
