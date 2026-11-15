import { createSocket } from 'node:dgram'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'

const SADP_MCAST = '239.255.255.250'
const SADP_PORT = 37020

function localIpv4s () {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list || []) {
      if (info.internal) continue
      const fam = info.family
      if (fam !== 'IPv4' && fam !== 4) continue
      out.push({ address: info.address, netmask: info.netmask })
    }
  }
  return out
}

function xmlTag (xml, tag) {
  const m = String(xml).match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function parseProbeMatch (xml, fromAddress) {
  if (!/<ProbeMatch[\s>]/i.test(xml)) return null
  const ip = xmlTag(xml, 'IPv4Address') || fromAddress
  if (!ip || ip === '0.0.0.0') return null
  const httpPort = Number(xmlTag(xml, 'HttpPort')) || 80
  const commandPort = Number(xmlTag(xml, 'CommandPort')) || null
  return {
    ip,
    http_port: httpPort,
    command_port: commandPort,
    mac: xmlTag(xml, 'MAC'),
    model: xmlTag(xml, 'DeviceDescription'),
    serial: xmlTag(xml, 'DeviceSN'),
    software_version: xmlTag(xml, 'SoftwareVersion'),
    device_type: xmlTag(xml, 'DeviceType'),
    dhcp: xmlTag(xml, 'DHCP'),
    source: 'sadp'
  }
}

function probePayload () {
  const uuid = randomUUID().toUpperCase()
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`,
    'utf8'
  )
}

/**
 * Hikvision SADP multicast/broadcast discovery (UDP 37020).
 */
export function discoverSadp (timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map()
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    const payload = probePayload()
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      resolve([...found.values()])
    }

    socket.on('error', () => finish())
    socket.on('message', (msg, rinfo) => {
      const xml = msg.toString('utf8')
      const device = parseProbeMatch(xml, rinfo.address)
      if (!device) return
      const prev = found.get(device.ip)
      found.set(device.ip, prev ? { ...prev, ...device, source: 'sadp' } : device)
    })

    // Ephemeral bind so replies return to this socket (no conflict with SADP Tool on 37020)
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
      } catch {
        /* ignore */
      }
      try {
        socket.setMulticastTTL(32)
      } catch {
        /* ignore */
      }
      try {
        socket.addMembership(SADP_MCAST)
      } catch {
        /* ignore — membership helps when listening for late replies */
      }

      // Probe via multicast
      try {
        socket.send(payload, 0, payload.length, SADP_PORT, SADP_MCAST)
      } catch {
        /* ignore */
      }

      // And limited broadcast + per-interface directed broadcast
      try {
        socket.send(payload, 0, payload.length, SADP_PORT, '255.255.255.255')
      } catch {
        /* ignore */
      }

      for (const { address, netmask } of localIpv4s()) {
        try {
          socket.send(payload, 0, payload.length, SADP_PORT, SADP_MCAST)
        } catch {
          /* ignore */
        }
        const bcast = directedBroadcast(address, netmask)
        if (bcast) {
          try {
            socket.send(payload, 0, payload.length, SADP_PORT, bcast)
          } catch {
            /* ignore */
          }
        }
      }

      setTimeout(finish, Math.max(500, timeoutMs))
    })
  })
}

function ipv4ToInt (ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0
}

function intToIpv4 (n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

function directedBroadcast (address, netmask) {
  try {
    const a = ipv4ToInt(address)
    const m = ipv4ToInt(netmask)
    return intToIpv4((a & m) | (~m >>> 0))
  } catch {
    return null
  }
}

function hostsInSlash24 (address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4) return []
  const base = `${parts[0]}.${parts[1]}.${parts[2]}`
  const hosts = []
  for (let i = 1; i <= 254; i++) {
    const ip = `${base}.${i}`
    if (ip !== address) hosts.push(ip)
  }
  return hosts
}

async function probeIsapi (ip, port, timeoutMs) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`http://${ip}:${port}/ISAPI/System/deviceInfo`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Accept: 'application/xml' }
    })
    const www = String(res.headers.get('www-authenticate') || '')
    const looksIsapi =
      res.status === 401 ||
      res.status === 200 ||
      /digest|basic/i.test(www) ||
      (await res.text().catch(() => '')).includes('DeviceInfo')
    if (!looksIsapi) return null
    return {
      ip,
      http_port: port,
      model: null,
      serial: null,
      source: 'isapi',
      isapi: true,
      auth_required: res.status === 401
    }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Scan local /24 networks for HTTP ISAPI fingerprints (port 80 / 8000).
 * Slower fallback when SADP multicast is filtered.
 */
export async function discoverIsapiHttp ({
  timeoutMs = 400,
  concurrency = 40,
  ports = [80, 8000]
} = {}) {
  const hosts = new Set()
  for (const { address } of localIpv4s()) {
    for (const h of hostsInSlash24(address)) hosts.add(h)
  }
  const queue = [...hosts]
  const found = new Map()
  let i = 0

  async function worker () {
    while (i < queue.length) {
      const ip = queue[i++]
      for (const port of ports) {
        const hit = await probeIsapi(ip, port, timeoutMs)
        if (hit) {
          const prev = found.get(ip)
          if (!prev || (prev.http_port !== 80 && hit.http_port === 80)) {
            found.set(ip, hit)
          }
          break
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker()))
  return [...found.values()]
}

/**
 * Discover LAN cameras: SADP first, then optional ISAPI subnet scan.
 */
export async function discoverCameras ({
  timeoutMs = 3000,
  scanSubnet = true,
  scanTimeoutMs = 350
} = {}) {
  const byIp = new Map()

  const sadp = await discoverSadp(timeoutMs)
  for (const d of sadp) {
    byIp.set(d.ip, { ...d, sources: ['sadp'] })
  }

  if (scanSubnet) {
    const http = await discoverIsapiHttp({ timeoutMs: scanTimeoutMs })
    for (const d of http) {
      const prev = byIp.get(d.ip)
      if (prev) {
        prev.sources = [...new Set([...(prev.sources || []), 'isapi'])]
        prev.isapi = true
        if (!prev.http_port) prev.http_port = d.http_port
      } else {
        byIp.set(d.ip, { ...d, sources: ['isapi'] })
      }
    }
  }

  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }))
}
