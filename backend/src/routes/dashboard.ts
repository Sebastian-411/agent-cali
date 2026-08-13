import { and, desc, eq, gte, isNotNull, sql as raw } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

import { db } from '../db/client.js'
import { auditLog, messages, monitoredGroups, reports } from '../db/schema.js'

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard/summary', async () => {
    const since24h = new Date(Date.now() - 86_400_000)

    const byStatus = await db
      .select({ status: reports.status, count: raw<number>`count(*)::int` })
      .from(reports)
      .groupBy(reports.status)

    const byPriority = await db
      .select({ priority: reports.priority, count: raw<number>`count(*)::int` })
      .from(reports)
      .where(raw`${reports.closedAt} is null`)
      .groupBy(reports.priority)

    const byCategory = await db
      .select({ category: reports.category, count: raw<number>`count(*)::int` })
      .from(reports)
      .where(gte(reports.createdAt, since24h))
      .groupBy(reports.category)
      .orderBy(desc(raw`count(*)`))

    // postgres.js no infiere el tipo de un Date dentro de un fragmento crudo:
    // hay que pasarlo como ISO y castear explícitamente.
    const since24hIso = since24h.toISOString()

    const [messageStats] = await db
      .select({
        total: raw<number>`count(*)::int`,
        last24h: raw<number>`count(*) filter (where ${messages.sentAt} >= ${since24hIso}::timestamptz)::int`,
        relevant: raw<number>`count(*) filter (where ${messages.relevant})::int`,
        pending: raw<number>`count(*) filter (where ${messages.processedAt} is null)::int`,
      })
      .from(messages)

    const [groupStats] = await db
      .select({
        total: raw<number>`count(*)::int`,
        enabled: raw<number>`count(*) filter (where ${monitoredGroups.enabled})::int`,
      })
      .from(monitoredGroups)
      .where(eq(monitoredGroups.role, 'SOURCE'))

    const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.count]))
    const priorityMap = Object.fromEntries(byPriority.map((r) => [r.priority, r.count]))

    return {
      reports: {
        critical: priorityMap.CRITICAL ?? 0,
        high: priorityMap.HIGH ?? 0,
        inVerification: (statusMap.VOTING ?? 0) + (statusMap.PENDING_VERIFICATION ?? 0),
        supported: (statusMap.SUPPORTED ?? 0) + (statusMap.VERIFIED ?? 0),
        dismissed: (statusMap.DISMISSED ?? 0) + (statusMap.DISPUTED ?? 0),
        byStatus: statusMap,
        byCategory,
      },
      messages: messageStats ?? { total: 0, last24h: 0, relevant: 0, pending: 0 },
      groups: groupStats ?? { total: 0, enabled: 0 },
    }
  })

  /** Puntos para el mapa: sólo reportes con zona geocodificada. */
  app.get('/api/dashboard/map', async () => {
    const rows = await db
      .select({
        id: reports.id,
        title: reports.title,
        category: reports.category,
        priority: reports.priority,
        status: reports.status,
        zone: reports.zone,
        lat: reports.lat,
        lng: reports.lng,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(and(isNotNull(reports.lat), isNotNull(reports.lng)))
      .orderBy(desc(reports.createdAt))
      .limit(300)

    return { points: rows }
  })

  /** Requisito 23: actividad del agente visible para el administrador. */
  app.get('/api/dashboard/activity', async (request) => {
    const limit = Math.min(Number((request.query as any)?.limit ?? 100), 500)
    const rows = await db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
    return { activity: rows }
  })
}
