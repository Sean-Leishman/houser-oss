import { defineConfig } from 'vite'
import { handleApi } from './server/api.mjs'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [{ name: 'houser-api', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      handleApi(request, response).then((handled) => { if (!handled) next() }).catch(next)
    })
  } }],
})
