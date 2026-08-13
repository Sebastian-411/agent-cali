import type { FastifyInstance } from 'fastify'

import { config } from '../lib/config.js'
import { safeEqual } from '../lib/hash.js'
import { handleWebhook } from '../pipeline/ingest.js'
import type { EvolutionWebhookBody } from '../pipeline/ingest.js'

function tokenFrom(headers: Record<string, unknown>, query: Record<string, unknown>): string {
  const header = headers['x-webhook-token']
  if (typeof header === 'string') return header
  const q = query.token
  return typeof q === 'string' ? q : ''
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Evolution puede añadir el nombre del evento a la ruta cuando byEvents=true.
  const handler = async (request: any, reply: any) => {
    const token = tokenFrom(request.headers, request.query ?? {})
    if (!config.webhookToken || !safeEqual(token, config.webhookToken)) {
      return reply.code(401).send({ error: 'token inválido' })
    }

    try {
      const result = await handleWebhook(request.body as EvolutionWebhookBody)
      return reply.send({ ok: true, ...result })
    } catch (error) {
      request.log.error({ err: error }, 'fallo procesando webhook')
      // Devolvemos 200 para que Evolution no reintente en bucle.
      return reply.send({ ok: false })
    }
  }

  app.post('/api/webhooks/evolution', handler)
  app.post('/api/webhooks/evolution/*', handler)
}
