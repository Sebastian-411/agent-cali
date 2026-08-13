import { sql as raw } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

import { db } from '../db/client.js'
import { messages, monitoredGroups } from '../db/schema.js'
import { evolution } from '../evolution/client.js'
import { config } from '../lib/config.js'
import { secrets } from '../lib/secrets.js'
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
      const result = await evolution.setWebhook(config.evolution.instance, url, secrets().webhookToken)
      return { ok: true, url, result }
    } catch (error) {
      return reply.code(502).send({ error: String(error) })
    }
  })

  /**
   * "¿Ya está leyendo mensajes?" es una cadena de cuatro eslabones y basta con
   * que falle uno para que no entre nada. Esto los revisa todos y dice cuál es
   * el que hay que arreglar.
   */
  app.get('/api/admin/diagnostics', async () => {
    const checks: Array<{
      id: string
      ok: boolean
      label: string
      detail: string
      action: string
    }> = []

    let state = 'desconocido'
    let webhookUrl = ''
    try {
      const raw = (await evolution.connectionState(config.evolution.instance)) as Record<string, any>
      state = raw?.instance?.state ?? raw?.state ?? 'desconocido'
    } catch (error) {
      state = `error: ${String(error).slice(0, 80)}`
    }
    try {
      const raw = (await evolution.findWebhook(config.evolution.instance)) as Record<string, any>
      webhookUrl = raw?.enabled === false ? '' : (raw?.url ?? '')
    } catch {
      webhookUrl = ''
    }

    checks.push({
      id: 'whatsapp',
      ok: state === 'open',
      label: 'WhatsApp vinculado',
      detail: state === 'open' ? 'conectado' : `estado: ${state}`,
      action: 'Escanea el QR de arriba con el teléfono del proyecto.',
    })

    const esperado = `${config.publicUrl}/api/webhooks/evolution`
    checks.push({
      id: 'webhook',
      ok: Boolean(webhookUrl) && webhookUrl.startsWith(config.publicUrl),
      label: 'Webhook apuntando a este backend',
      detail: webhookUrl || 'sin configurar',
      action: `Usa el botón de abajo. Debe quedar en ${esperado}`,
    })

    const grupos = await db.select().from(monitoredGroups)
    const fuentes = grupos.filter((g) => g.enabled && g.role === 'SOURCE')
    const central = grupos.filter((g) => g.enabled && g.role === 'NOTIFICATION')
    checks.push({
      id: 'grupos',
      ok: fuentes.length > 0 && central.length > 0,
      label: 'Grupos habilitados',
      detail: `${fuentes.length} monitoreado(s), ${central.length} central`,
      action:
        'Trae los grupos y habilítalos en Grupos: al menos uno monitoreado y uno central.',
    })

    const [stats] = await db
      .select({
        total: raw<number>`count(*)::int`,
        ultimo: raw<Date | null>`max(${messages.sentAt})`,
      })
      .from(messages)

    const total = stats?.total ?? 0
    const ultimo = stats?.ultimo ? new Date(stats.ultimo) : null
    const minutos = ultimo ? Math.floor((Date.now() - ultimo.getTime()) / 60_000) : null

    checks.push({
      id: 'mensajes',
      ok: total > 0,
      label: 'Mensajes entrando',
      detail:
        total === 0
          ? 'todavía no llega ninguno'
          : `${total} recibidos · el último hace ${minutos} min`,
      action:
        'Escribe algo en un grupo monitoreado. Si no aparece, revisa que el número del proyecto esté dentro de ese grupo.',
    })

    return { ok: checks.every((c) => c.ok), checks }
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
