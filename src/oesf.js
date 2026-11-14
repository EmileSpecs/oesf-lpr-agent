export function createOesfClient ({ api, apiKey, deviceToken }) {
  const base = String(api || '').replace(/\/$/, '')

  async function request (path, { method = 'GET', body, headers = {}, etag } = {}) {
    const h = { Accept: 'application/json', ...headers }
    if (apiKey) h['x-access-token'] = apiKey
    if (deviceToken) h['x-device-token'] = deviceToken
    if (etag) h['If-None-Match'] = etag
    if (body !== undefined) h['Content-Type'] = 'application/json'

    const res = await fetch(`${base}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    if (res.status === 304) {
      return { status: 304, body: null, etag: res.headers.get('etag') }
    }

    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (!res.ok) {
      const msg = json?.error || json?.message || text || `HTTP ${res.status}`
      const err = new Error(`${method} ${path} failed: ${msg}`)
      err.status = res.status
      throw err
    }
    return { status: res.status, body: json, etag: res.headers.get('etag') }
  }

  return {
    announce: (payload) => request('/site-agents/announce', { method: 'POST', body: payload }),
    status: () => request('/site-agents/status'),
    listCameras: () => request('/lpr-agent/cameras'),
    getPlates: (etag) => request('/lpr-agent/plates', { etag }),
    reportSync: (cameraId, payload) =>
      request(`/lpr-agent/cameras/${cameraId}/sync`, { method: 'POST', body: payload })
  }
}
