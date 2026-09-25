import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { handleApi } from './api.mjs'

const root = resolve(process.cwd(), 'dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

createServer(async (request, response) => {
  try {
    if (await handleApi(request, response)) return
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
    const target = resolve(root, `.${pathname}`)
    if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403); response.end(); return }
    const file = (await stat(target).catch(() => null))?.isFile() ? target : join(root, 'index.html')
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error.message)
  }
}).listen(Number(process.env.PORT || 4173), () => {
  process.stdout.write(`Houser server: http://localhost:${process.env.PORT || 4173}\n`)
})
