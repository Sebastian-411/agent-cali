import type { FastifyInstance } from 'fastify'

import { evolution } from '../evolution/client.js'
import { config } from '../lib/config.js'
import { runCycle } from '../pipeline/scheduler.js'

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/instance', async (_request, reply) => {
    try {
      const [state, webhook] = await Promise.all([
        evolution.connectionState(config.evolution.instance),
        evolution.findWebhook(config.evolution.instance).catch(() => null),
      ])
      return { instance: config.evolution.instance, state, webhook }
    } catch (error) {
      return reply.code(502).send({ error: String(error) })
    }
  })

  /** Devuelve el QR para vincular el WhatsApp de la instancia dedicada. */
  app.get('/api/admin/instance/qr', async (_request, reply) => {
    try {
      const result = await evolution.connect(config.evolution.instance)
      return { qr: result.base64 ?? null, code: result.code ?? null }
    } catch (error) {
      return reply.code(502).send({ error: String(error) })
    }
  })

  app.post('/api/admin/instance/webhook', async (_request, reply) => {
    if (!config.publicUrl) {
      return reply.code(400).send({ error: 'Falta PUBLIC_URL' })
    }
    const url = `${config.publicUrl}/api/webhooks/evolution`
    try {
      const result = await evolution.setWebhook(config.evolution.instance, url, config.webhookToken)
      return { ok: true, url, result }
    } catch (error) {
      return reply.code(502).send({ error: String(error) })
    }
  })

  /** Dispara un ciclo del pipeline sin esperar al temporizador. */
  app.post('/api/admin/run-cycle', async () => {
    await runCycle()
    return { ok: true }
  })

  app.get('/api/admin/config', async () => ({
    pipeline: config.pipeline,
    models: {
      classify: config.gemini.classifyModel,
      cluster: config.gemini.clusterModel,
      classifyThinkingBudget: config.gemini.classifyThinkingBudget,
      clusterThinkingBudget: config.gemini.clusterThinkingBudget,
    },
    instance: config.evolution.instance,
    publicUrl: config.publicUrl,
  }))
}
