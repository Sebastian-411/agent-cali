import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { config } from './lib/config.js'
import { safeEqual } from './lib/hash.js'
import { adminRoutes } from './routes/admin.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { groupRoutes } from './routes/groups.js'
import { reportRoutes } from './routes/reports.js'
import { webhookRoutes } from './routes/webhook.js'

/** Rutas públicas: el webhook trae su propio token, y /health no expone datos. */
const PUBLIC_PATHS = ['/api/health', '/api/webhooks/evolution']

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 5 * 1024 * 1024,
  })

  // Varias acciones (configurar el webhook, sincronizar grupos, forzar un ciclo)
  // son POST sin cuerpo. Si el cliente igual anuncia application/json, Fastify
  // los rechaza con FST_ERR_CTP_EMPTY_JSON_BODY: aquí un cuerpo vacío se trata
  // como un objeto vacío, que es lo que esas rutas esperan.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') return done(null, {})
    try {
      done(null, JSON.parse(text))
    } catch (error) {
      // El parser propio pierde el 400 que pone el de Fastify: un JSON
      // malformado es culpa del cliente, no un fallo del servidor.
      ;(error as Error & { statusCode?: number }).statusCode = 400
      done(error as Error, undefined)
    }
  })

  // Sólo si el panel vive en otro origen. Con el proxy /api del frontend no
  // hace falta, y dejarlo apagado evita exponer la API a orígenes arbitrarios.
  if (config.corsOrigins.length > 0) {
    await app.register(cors, {
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'x-api-key'],
      maxAge: 86_400,
    })
    app.log.info({ origins: config.corsOrigins }, 'CORS habilitado')
  }

  // Requisito 24: el dashboard y sus datos quedan detrás de una clave.
  app.addHook('onRequest', async (request, reply) => {
    // El preflight no lleva la clave: lo responde el plugin de CORS.
    if (request.method === 'OPTIONS') return

    const url = request.url.split('?')[0] ?? ''
    if (PUBLIC_PATHS.some((path) => url === path || url.startsWith(`${path}/`))) return

    const provided = request.headers['x-api-key']
    if (typeof provided !== 'string' || !safeEqual(provided, config.adminApiKey)) {
      return reply.code(401).send({ error: 'no autorizado' })
    }
  })

  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }))

  await app.register(webhookRoutes)
  await app.register(groupRoutes)
  await app.register(reportRoutes)
  await app.register(dashboardRoutes)
  await app.register(adminRoutes)

  return app
}
