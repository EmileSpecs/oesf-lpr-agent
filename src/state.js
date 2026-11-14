import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DEFAULT_STATE = {
  api_url: '',
  site_agent_id: null,
  device_token: null,
  pairing_code: null,
  api_key: null,
  status: 'unannounced',
  cameras: {}
}

export function statePath (configPath) {
  const dir = dirname(resolve(configPath))
  return resolve(dir, 'state.json')
}

export function loadState (path) {
  if (!existsSync(path)) return { ...DEFAULT_STATE, cameras: {} }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return {
      ...DEFAULT_STATE,
      ...raw,
      cameras: raw.cameras && typeof raw.cameras === 'object' ? raw.cameras : {}
    }
  } catch {
    return { ...DEFAULT_STATE, cameras: {} }
  }
}

export function saveState (path, state) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8')
}
