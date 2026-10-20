import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { createJourneyService } from './journeys.mjs'
import { createListingService } from './listings.mjs'
import { createRoutingService, routingModes, validPoint } from './routing.mjs'
import { createTransitService, transitParts } from './transit.mjs'

if (existsSync('.env')) process.loadEnvFile('.env')

const homes = createListingService()
const getTransit = createTransitService()
const routing = createRoutingService()
const journeys = createJourneyService()

function sendJson(response, status, body, request) {
  const json = JSON.stringify(body)
  const compress = json.length > 16000 && /\bgzip\b/.test(request?.headers['accept-encoding'] || '')
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(compress ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) })
  response.end(compress ? gzipSync(json) : json)
}

const encoded = new Map()

function sendVersioned(request, response, body, version) {
  const etag = `"${createHash('sha1').update(version).digest('base64url').slice(0, 22)}"`
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding' }
  if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return }
  if (!encoded.has(etag)) {
    if (encoded.size >= 40) encoded.delete(encoded.keys().next().value)
    encoded.set(etag, { json: Buffer.from(JSON.stringify(body)) })
  }
  const entry = encoded.get(etag)
  const accept = request.headers['accept-encoding'] || ''
  if (entry.json.length > 16000 && /\bbr\b/.test(accept)) {
    entry.br ??= brotliCompressSync(entry.json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
    response.writeHead(200, { ...headers, 'Content-Encoding': 'br' })
    response.end(entry.br)
  } else if (entry.json.length > 16000 && /\bgzip\b/.test(accept)) {
    entry.gzip ??= gzipSync(entry.json)
    response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' })
    response.end(entry.gzip)
  } else {
    response.writeHead(200, headers)
    response.end(entry.json)
  }
}

async function readBody(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const coordinate = (value) => {
  const parts = String(value ?? '').split(',').map((part) => (part.trim() === '' ? NaN : Number(part)))
  return validPoint(parts) ? parts : null
}

export async function handleApi(request, response) {
  const url = new URL(request.url || '/', 'http://localhost')
  const params = url.searchParams
  try {
    if (url.pathname === '/api/transit' && request.method === 'GET') {
      const part = params.get('part') || 'rail'
      const at = coordinate(`${params.get('lon')},${params.get('lat')}`)
      if (!at || !transitParts.includes(part)) sendJson(response, 400, { error: `Provide a valid longitude, latitude and part (${transitParts.join(', ')})` })
      else {
        const result = await getTransit(part, at[0], at[1])
        sendVersioned(request, response, result, `${part}|${result.area}|${result.updatedAt}|${result.stale}`)
      }
      return true
    }

    if (url.pathname === '/api/sources' && request.method === 'GET') {
      sendJson(response, 200, await homes.coverage(), request)
      return true
    }

    if (url.pathname === '/api/listings' && request.method === 'GET') {
      const city = (params.get('city') || '').trim().slice(0, 80)
      const result = await homes.getListings({ city, center: [Number(params.get('lon') ?? NaN), Number(params.get('lat') ?? NaN)] })
      if (result.status === 200) sendVersioned(request, response, result.body, JSON.stringify(result.body))
      else sendJson(response, result.status, result.body, request)
      return true
    }

    if (url.pathname === '/api/commute' && request.method === 'POST') {
      const body = await readBody(request, 200_000)
      let input = null
      try { input = body && JSON.parse(body.toString('utf8')) } catch {}
      if (!input || !routingModes.includes(input.mode) || !validPoint(input.to) || !Array.isArray(input.from) || input.from.length > 500 || !input.from.every(validPoint)) {
        sendJson(response, 400, { error: 'Provide a walk, bike, quiet or car mode, one destination and up to 500 origins' })
      } else sendJson(response, 200, await routing.durations(input), request)
      return true
    }

    if (url.pathname === '/api/reach' && request.method === 'GET') {
      const mode = params.get('mode')
      const at = coordinate(`${params.get('lon')},${params.get('lat')}`)
      if (!routingModes.includes(mode) || !at) sendJson(response, 400, { error: 'Provide a walk, bike, quiet or car mode and a location' })
      else sendJson(response, 200, await routing.reach({ mode, at }), request)
      return true
    }

    if (url.pathname === '/api/journeys' && request.method === 'GET') {
      const home = coordinate(params.get('from')), place = coordinate(params.get('to'))
      if (!home || !place) sendJson(response, 400, { error: 'Provide a home and a daily place' })
      else sendJson(response, 200, await journeys.journeys({ home, place }), request)
      return true
    }

    if (url.pathname === '/api/route' && request.method === 'GET') {
      const mode = params.get('mode')
      const from = coordinate(params.get('from')), to = coordinate(params.get('to'))
      if (!routingModes.includes(mode) || !from || !to) sendJson(response, 400, { error: 'Provide a walk, bike, quiet or car mode, an origin and a destination' })
      else sendJson(response, 200, await routing.route({ mode, from, to }), request)
      return true
    }

  } catch (error) {
    sendJson(response, 502, { error: error instanceof Error ? error.message : 'Data source unavailable' })
    return true
  }
  return false
}
