import { normalizePlate } from './plates.js'

/**
 * Lightweight parse of Hikvision (and JSON) Alarm Server bodies for filter decisions.
 * Does not need images — matches are forwarded as the original raw buffer.
 */
export function classifyLprBody (contentType, bodyBuf) {
  const ct = String(contentType || '').toLowerCase()
  const text = bodyBuf.toString('utf8')

  if (/<eventType>\s*heartbeat\s*<\/eventType>/i.test(text) || /"eventType"\s*:\s*"heartbeat"/i.test(text)) {
    return { kind: 'heartbeat' }
  }

  let plate = null
  const xmlPlate = text.match(/<licensePlate>\s*([^<]*?)\s*<\/licensePlate>/i)
  if (xmlPlate) plate = xmlPlate[1]

  if (!plate) {
    const jsonPlate = text.match(/"licensePlate"\s*:\s*"([^"]*)"/i)
      || text.match(/"plateNumber"\s*:\s*"([^"]*)"/i)
      || text.match(/"plate"\s*:\s*"([^"]*)"/i)
    if (jsonPlate) plate = jsonPlate[1]
  }

  // Multipart without readable XML in the first chunk — treat as opaque forward candidate
  if (!plate && ct.includes('multipart/') && !/<EventNotificationAlert[\s>]/i.test(text) && !/"licensePlate"/i.test(text)) {
    return { kind: 'opaque' }
  }

  const normalised = normalizePlate(plate)
  if (!normalised) {
    return { kind: 'ignored', reason: 'empty_plate' }
  }
  return { kind: 'anpr', plate: normalised }
}

/**
 * @returns {{ action: 'forward' | 'drop', reason: string, plate?: string }}
 */
export function decideForward (classification, plateStore) {
  if (classification.kind === 'heartbeat') {
    return { action: 'forward', reason: 'heartbeat' }
  }
  if (classification.kind === 'opaque') {
    // Safer to forward unknown multipart than drop sightings we failed to parse
    return { action: 'forward', reason: 'opaque_body' }
  }
  if (classification.kind === 'ignored') {
    return { action: 'drop', reason: classification.reason || 'ignored' }
  }
  if (classification.kind === 'anpr') {
    if (plateStore.size === 0) {
      // No list yet — forward so cloud plateCache remains the safety net
      return { action: 'forward', reason: 'empty_local_list', plate: classification.plate }
    }
    if (plateStore.has(classification.plate)) {
      return { action: 'forward', reason: 'matched', plate: classification.plate }
    }
    return { action: 'drop', reason: 'not_in_list', plate: classification.plate }
  }
  return { action: 'drop', reason: 'unknown' }
}

export function readRawBody (req, limitBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limitBytes) {
        reject(new Error('body_too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
