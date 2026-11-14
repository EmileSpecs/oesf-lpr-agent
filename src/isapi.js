import DigestFetch from 'digest-fetch'
import * as XLSX from 'xlsx'

function baseUrl ({ host, port, useHttps }) {
  const clean = String(host || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')
  const p = port && Number(port) > 0 ? Number(port) : useHttps ? 443 : 80
  const proto = useHttps || p === 443 ? 'https' : 'http'
  const def = proto === 'https' ? 443 : 80
  return `${proto}://${p === def ? clean : `${clean}:${p}`}`
}

export function buildPlateBlacklistXls (plates) {
  const header = ['License Plate', 'List Type', 'Card No.', 'Start Time', 'End Time']
  const rows = plates.map((plate) => [plate, 1, '', '', ''])
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'biff8' }))
}

export async function pushPlateBlacklist (cam, plates) {
  const channel = Number(cam.channel) > 0 ? Number(cam.channel) : 1
  const xls = buildPlateBlacklistXls(plates)
  const url = `${baseUrl(cam)}/ISAPI/Traffic/channels/${channel}/licensePlateAuditData`
  const client = new DigestFetch(String(cam.user), String(cam.password), { basic: false })
  const res = await client.fetch(url, {
    method: 'PUT',
    body: xls,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(xls.length)
    }
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ISAPI HTTP ${res.status}: ${text.slice(0, 400)}`)
  }
  return { status: res.status, plateCount: plates.length, bytes: xls.length }
}
