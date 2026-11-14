import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** True when running inside a pkg / SEA single executable. */
export function isPackaged () {
  return typeof process.pkg !== 'undefined' || !!process.env.OESF_LPR_AGENT_PACKAGED
}

/**
 * Writable data directory for config.yaml + state.json.
 * Packaged installs use a per-user folder (not Program Files).
 */
export function dataDir () {
  if (process.env.OESF_LPR_AGENT_DATA) {
    return resolve(process.env.OESF_LPR_AGENT_DATA)
  }
  if (isPackaged()) {
    if (process.platform === 'win32') {
      const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      return join(base, 'OESF', 'LPR Agent')
    }
    return join(homedir(), '.local', 'share', 'oesf-lpr-agent')
  }
  return process.cwd()
}

export function ensureDataDir () {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function defaultConfigPath () {
  if (process.env.OESF_LPR_AGENT_CONFIG) {
    return resolve(process.env.OESF_LPR_AGENT_CONFIG)
  }
  return join(ensureDataDir(), 'config.yaml')
}
