// npm run homes:fetch [-- <connector> ...]
import { relative } from 'node:path'
import { storeHomes } from './listings.mjs'
import { connectors } from './sources/index.mjs'

if (!connectors.length) {
  console.log('No connectors in server/sources/index.mjs. See docs/sources.md, or put your own file in data/.')
  process.exit(0)
}
const wanted = process.argv.slice(2)
const unknown = wanted.filter((id) => !connectors.some((connector) => connector.id === id))
if (unknown.length) {
  console.error(`Unknown connector: ${unknown.join(', ')}. Available: ${connectors.map((connector) => connector.id).join(', ')}`)
  process.exit(1)
}
for (const connector of connectors.filter((item) => !wanted.length || wanted.includes(item.id))) {
  const started = Date.now()
  console.log(`${connector.name}: reading…`)
  const listings = await connector.fetch({ onProgress: (done, total) => { if (done % 25 === 0 || done === total) console.log(`${connector.name}: ${done} of ${total}`) } })
  const file = await storeHomes(connector, listings)
  console.log(`${connector.name}: stored ${listings.length} homes in ${relative(process.cwd(), file)} after ${Math.round((Date.now() - started) / 1000)} s`)
}
