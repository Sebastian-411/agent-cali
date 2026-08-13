import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { db } from '../db/client.js'
import { monitoredGroups } from '../db/schema.js'
import { evolution } from '../evolution/client.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'

const upsertSchema = z.object({
  remoteJid: z.string().min(5),
  groupName: z.string().min(1),
  enabled: z.boolean().default(true),
  role: z.enum(['SOURCE', 'NOTIFICATION']).default('SOURCE'),
})

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  role: z.enum(['SOURCE', 'NOTIFICATION']).optional(),
  groupName: z.string().min(1).optional(),
})

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups', async () => {
    const rows = await db.select().from(monitoredGroups).orderBy(monitoredGroups.groupName)
    return { groups: rows }
  })

  /** Grupos que ve el WhatsApp conectado, con su estado de monitoreo. */
  app.get('/api/groups/available', async (_request, reply) => {
    try {
      const remote = await evolution.fetchGroups(config.evolution.instance)
      const known = await db.select().from(monitoredGroups)
      const byJid = new Map(known.map((g) => [g.remoteJid, g]))

      return {
        groups: remote.map((g) => ({
          remoteJid: g.id,
          groupName: g.subject,
          size: g.size ?? null,
          monitored: byJid.has(g.id),
          enabled: byJid.get(g.id)?.enabled ?? false,
          role: byJid.get(g.id)?.role ?? null,
        })),
      }
    } catch (error) {
      return reply.code(502).send({ error: 'No se pudo consultar Evolution API', detail: String(error) })
    }
  })

  /**
   * Registra todos los grupos visibles, DESHABILITADOS por defecto. Equivale a
   * `npm run sync:groups`, pero se puede disparar desde el panel: en un
   * despliegue en contenedores no siempre hay terminal a mano.
   */
  app.post('/api/groups/sync', async (_request, reply) => {
    let remote
    try {
      remote = await evolution.fetchGroups(config.evolution.instance)
    } catch (error) {
      return reply.code(502).send({ error: 'No se pudo consultar Evolution API', detail: String(error) })
    }

    let added = 0
    for (const group of remote) {
      const [row] = await db
        .insert(monitoredGroups)
        .values({ remoteJid: group.id, groupName: group.subject, enabled: false, role: 'SOURCE' })
        .onConflictDoUpdate({
          target: monitoredGroups.remoteJid,
          // Sólo refrescamos el nombre: nunca reactivamos un grupo que un
          // administrador deshabilitó a propósito.
          set: { groupName: group.subject, updatedAt: new Date() },
        })
        .returning({ createdAt: monitoredGroups.createdAt, updatedAt: monitoredGroups.updatedAt })
      if (row && row.createdAt.getTime() === row.updatedAt.getTime()) added += 1
    }

    await audit('GROUP_ADDED', {
      actor: 'admin',
      detail: { synced: remote.length, nuevos: added },
    })

    return { synced: remote.length, added }
  })

  app.post('/api/groups', async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const body = parsed.data

    const [row] = await db
      .insert(monitoredGroups)
      .values(body)
      .onConflictDoUpdate({
        target: monitoredGroups.remoteJid,
        set: {
          groupName: body.groupName,
          enabled: body.enabled,
          role: body.role,
          updatedAt: new Date(),
        },
      })
      .returning()

    await audit('GROUP_ADDED', {
      entityType: 'group',
      entityId: row!.id,
      actor: 'admin',
      detail: { remoteJid: body.remoteJid, role: body.role },
    })

    return reply.code(201).send({ group: row })
  })

  app.patch('/api/groups/:id', async (request, reply) => {
    const id = Number.parseInt((request.params as { id: string }).id, 10)
    const parsed = patchSchema.safeParse(request.body)
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido' })
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const [row] = await db
      .update(monitoredGroups)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(monitoredGroups.id, id))
      .returning()

    if (!row) return reply.code(404).send({ error: 'grupo no encontrado' })

    if (parsed.data.enabled !== undefined) {
      await audit(parsed.data.enabled ? 'GROUP_ENABLED' : 'GROUP_DISABLED', {
        entityType: 'group',
        entityId: id,
        actor: 'admin',
      })
    }

    return { group: row }
  })

  app.delete('/api/groups/:id', async (request, reply) => {
    const id = Number.parseInt((request.params as { id: string }).id, 10)
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido' })
    await db.delete(monitoredGroups).where(eq(monitoredGroups.id, id))
    await audit('GROUP_DISABLED', { entityType: 'group', entityId: id, actor: 'admin' })
    return reply.code(204).send()
  })
}
