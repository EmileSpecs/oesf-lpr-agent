/** Match oesf-api `normalizePlate`: uppercase alphanumeric only. */
export function normalizePlate (input) {
  if (input == null) return ''
  return String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * In-memory plate allow-list used to filter camera events before forwarding to OESF.
 * Replaced wholesale whenever GET /lpr-agent/plates returns a new list.
 */
export function createPlateStore () {
  let plates = new Set()
  let etag = null
  let version = null
  let updatedAt = null

  return {
    get size () {
      return plates.size
    },
    get etag () {
      return etag
    },
    get version () {
      return version
    },
    get updatedAt () {
      return updatedAt
    },
    has (plate) {
      const n = normalizePlate(plate)
      return n ? plates.has(n) : false
    },
    replace (list, meta = {}) {
      plates = new Set((list || []).map(normalizePlate).filter(Boolean))
      if (meta.etag != null) etag = meta.etag
      if (meta.version != null) version = meta.version
      updatedAt = meta.updated_at || new Date().toISOString()
      return plates.size
    },
    snapshot () {
      return {
        count: plates.size,
        etag,
        version,
        updated_at: updatedAt
      }
    }
  }
}
