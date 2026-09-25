import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const USER_AGENT = 'Houser/0.1 (+https://github.com/prioneto/houser-oss)'

export function createLocationCache({ namespace, ttlMs, staleMs, cacheDir = join(process.cwd(), '.cache'), now = Date.now, revalidate = false }) {
  const pending = new Map()
  const failures = new Map()
  const memory = new Map()
  const fileFor = (key) => join(cacheDir, `${namespace}-${createHash('sha256').update(key).digest('hex').slice(0, 24)}.json`)
  const remember = (key, result) => {
    if (memory.size >= 100) memory.delete(memory.keys().next().value)
    memory.set(key, result)
  }
  async function read(key) {
    if (memory.has(key)) return memory.get(key)
    try {
      const result = JSON.parse(await readFile(fileFor(key), 'utf8'))
      if (Number.isFinite(result.updatedAt) && result.data) { remember(key, result); return result }
    } catch {}
    return null
  }
  function recentFailure(key) {
    const failure = failures.get(key)
    return failure && now() - failure.at < 60_000 ? failure : null
  }
  function load(key, loader) {
    if (!pending.has(key)) {
      const request = (async () => {
        const data = await loader()
        const result = { data, updatedAt: now() }
        remember(key, result)
        failures.delete(key)
        await mkdir(cacheDir, { recursive: true })
        const target = fileFor(key)
        const temporary = `${target}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify(result), 'utf8')
        await rename(temporary, target)
        return result
      })().catch((error) => {
        if (failures.size >= 100) failures.delete(failures.keys().next().value)
        failures.set(key, { at: now(), message: error.message })
        throw error
      }).finally(() => pending.delete(key))
      pending.set(key, request)
    }
    return pending.get(key)
  }
  return async function get(key, loader, force = false) {
    const saved = await read(key)
    const age = saved ? now() - saved.updatedAt : Infinity
    if (saved && age < ttlMs && (!force || age < 60_000)) return { ...saved, cached: true, stale: false }
    if (revalidate && saved && age < staleMs && !force) {
      if (!recentFailure(key)) load(key, loader).catch(() => {})
      return { ...saved, cached: true, stale: true }
    }
    try {
      const failure = recentFailure(key)
      if (failure) throw new Error(failure.message)
      return { ...await load(key, loader), cached: false, stale: false }
    } catch (error) {
      if (saved && age < staleMs) return { ...saved, cached: true, stale: true, warning: error.message }
      throw error
    }
  }
}

export async function readJson(response, maxBytes = 20_000_000) {
  if (!response.ok) throw new Error(`Data source returned HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Data source response exceeded its size limit')
  let size = 0
  const chunks = []
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maxBytes) throw new Error('Data source response exceeded its size limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
