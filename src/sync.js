import { pushPlateBlacklist } from './isapi.js'

/**
 * Refresh the in-memory plate allow-list from OESF.
 * Optionally push the blacklist to cameras via ISAPI when `pushToCameras` is true
 * (legacy; filter mode does not need this).
 */
export async function syncPlateList (client, state, plateStore, log = console, opts = {}) {
  const pushToCameras = opts.pushToCameras === true
  const platesRes = await client.getPlates(plateStore.etag || state._etag)
  if (platesRes.status === 304) {
    log.info(`plate list unchanged (${plateStore.size} in memory)`)
    return { changed: false, count: plateStore.size }
  }

  const plates = platesRes.body?.plates || []
  const count = plateStore.replace(plates, {
    etag: platesRes.body?.etag || platesRes.etag,
    version: platesRes.body?.version,
    updated_at: platesRes.body?.updated_at
  })
  state._etag = plateStore.etag
  log.info(`plate list v${plateStore.version ?? '?'} — ${count} plate(s) cached for filter`)

  let assigned = []
  try {
    const listed = await client.listCameras()
    assigned = listed.body?.data || []
    state.assigned_cameras = assigned
  } catch (error) {
    log.warn(`could not list cameras: ${error.message}`)
  }

  // Always report cache refresh against each assigned camera (portal "last list sync")
  for (const cam of assigned) {
    try {
      await client.reportSync(cam.id, { ok: true, plate_count: count })
    } catch (error) {
      log.warn(`reportSync ${cam.id}: ${error.message}`)
    }
  }

  if (!pushToCameras) {
    return { changed: true, count }
  }

  const map = state.cameras || {}
  for (const cam of assigned) {
    const local = map[cam.id]
    if (!local?.host || !local?.user || local.password == null) {
      log.warn(`skip ISAPI ${cam.name || cam.id}: map host/user/password in the local UI`)
      continue
    }
    const label = `${cam.name || cam.id} @ ${local.host}`
    try {
      const result = await pushPlateBlacklist(
        {
          host: local.host,
          port: local.port,
          user: local.user,
          password: local.password,
          channel: local.channel,
          useHttps: !!local.use_https
        },
        plates
      )
      await client.reportSync(cam.id, { ok: true, plate_count: result.plateCount })
      log.info(`ok  ISAPI ${label} — ${result.plateCount} plates`)
    } catch (error) {
      const message = error?.message || String(error)
      try {
        await client.reportSync(cam.id, { ok: false, error: message })
      } catch {
        /* ignore */
      }
      log.error(`fail ISAPI ${label} — ${message}`)
    }
  }

  return { changed: true, count }
}
