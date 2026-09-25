import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { connectors as registered } from './sources/index.mjs'
import { transitArea } from './transit.mjs'

export const dataDir = join(process.cwd(), 'data')

const kinds = ['room', 'studio', 'apartment', 'house']
const text = (value, max = 200) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
const code = (value, length) => typeof value === 'string' && new RegExp(`^[A-Z]{${length}}$`).test(value) ? value : null
const https = (value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null } }

export function cleanListing(item, file) {
  if (!item || typeof item !== 'object') return null
  const [lon, lat] = Array.isArray(item.coordinates) ? item.coordinates : []
  const id = text(item.id, 120), price = number(item.price), currency = code(item.currency, 3) ?? file.currency
  if (!id || number(lon) == null || number(lat) == null || Math.abs(lon) > 180 || Math.abs(lat) > 90 || !(price > 0) || !currency) return null
  return {
    id, title: text(item.title) ?? 'Home', address: text(item.address) ?? '',
    coordinates: [lon, lat],
    coordinateAccuracy: ['exact', 'approximate'].includes(item.coordinateAccuracy) ? item.coordinateAccuracy : undefined,
    country: code(item.country, 2) ?? file.country,
    price, currency, pricePeriod: 'month',
    kind: kinds.includes(item.kind) ? item.kind : null,
    rooms: number(item.rooms), bedrooms: number(item.bedrooms), areaM2: number(item.areaM2),
    furnished: typeof item.furnished === 'boolean' ? item.furnished : null,
    image: https(item.image) ?? '', source: file.source, sourceUrl: https(item.sourceUrl) ?? undefined,
    availableFrom: typeof item.availableFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.availableFrom) ? item.availableFrom : undefined,
    lastSeenAt: new Date(file.fetchedAt).toISOString(),
  }
}

export async function storeHomes(connector, listings, dir = dataDir) {
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${connector.id}.json`)
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ source: connector.name, fetchedAt: new Date().toISOString(), listings }))
  await rename(temporary, file)
  return file
}

export function createListingService({ dir = dataDir, connectors = registered } = {}) {
  let stored = { key: null, files: [] }

  async function load() {
    const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
    const stats = await Promise.all(names.map((name) => stat(join(dir, name)).catch(() => null)))
    const key = names.map((name, index) => `${name}:${stats[index]?.mtimeMs}`).join('|')
    if (key === stored.key) return stored.files
    const files = []
    for (const [index, name] of names.entries()) {
      const id = basename(name, '.json')
      const connector = connectors.find((item) => item.id === id)
      try {
        const data = JSON.parse(await readFile(join(dir, name), 'utf8'))
        const file = { name, source: text(data.source, 60) ?? connector?.name ?? id, fetchedAt: Date.parse(data.fetchedAt) || stats[index]?.mtimeMs || 0,
          country: code(data.country, 2), currency: code(data.currency, 3), searchUrl: connector?.searchUrl }
        const items = Array.isArray(data.listings) ? data.listings : []
        const seen = new Set()
        const listings = items.map((item) => cleanListing(item, file)).filter((listing) => listing && !seen.has(listing.id) && seen.add(listing.id))
        files.push({ ...file, listings, skipped: items.length - listings.length })
      } catch (error) {
        files.push({ name, source: connector?.name ?? id, fetchedAt: 0, listings: [], skipped: 0, error: `${name} can't be read: ${error.message}` })
      }
    }
    stored = { key, files }
    return files
  }

  async function coverage() {
    const files = await load()
    const sources = files.map((file) => ({ name: file.source, file: file.name, count: file.listings.length, skipped: file.skipped, fetchedAt: file.fetchedAt || null,
      countries: [...new Set(file.listings.map((listing) => listing.country).filter(Boolean))].sort(), ...(file.error ? { error: file.error } : {}) }))
    return { sources, countries: [...new Set(sources.flatMap((source) => source.countries))].sort() }
  }

  async function getListings(query) {
    if (!query.city || !Array.isArray(query.center) || query.center.length !== 2 || !query.center.every(Number.isFinite) || Math.abs(query.center[0]) > 180 || Math.abs(query.center[1]) > 90) {
      return { status: 400, body: { mode: 'unavailable', reason: 'A city and valid coordinates are required' } }
    }
    const files = await load()
    if (!files.some((file) => file.listings.length)) {
      return { status: 503, body: { mode: 'unavailable', sources: [], reason: files.find((file) => file.error)?.error
        ?? 'No homes are stored yet. Run npm run homes:fetch, or add your own file to data/ (see docs/sources.md).' } }
    }
    const { bounds } = transitArea(query.center[0], query.center[1])
    const [west, south, east, north] = bounds
    const inArea = ({ coordinates: [lon, lat] }) => lon >= west && lon <= east && lat >= south && lat <= north
    const seen = new Set()
    const found = files.map((file) => ({ file, listings: file.listings.filter((listing) => inArea(listing) && !seen.has(listing.id) && seen.add(listing.id)) }))
    const shown = found.filter(({ listings }) => listings.length)
    const listings = shown.flatMap((entry) => entry.listings)
    const sources = (shown.length ? shown : found).map(({ file, listings: homes }) => ({ name: file.source, url: file.searchUrl?.(bounds) ?? '', status: 'checked',
      count: homes.length, total: null, updatedAt: file.fetchedAt || null }))
    return { status: 200, body: { mode: 'live', city: query.city, currency: listings[0]?.currency ?? 'EUR', listings, sources,
      updatedAt: shown.length ? Math.min(...shown.map(({ file }) => file.fetchedAt)) : null,
      reason: listings.length ? undefined : `No stored homes around ${query.city}.` } }
  }

  return { getListings, coverage }
}
