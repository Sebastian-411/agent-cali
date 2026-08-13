import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      // Sólo aplica a `npm run dev`. En el contenedor el proxy lo hace nginx.
      proxy: {
        '/api': env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000',
      },
    },
  }
})
