import { and, desc, eq, gte, inArray, sql as raw } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { db } from '../db/client.js'
import { evidence, messages, monitoredGroups, reports, votes } from '../db/schema.js'
import { audit } from '../lib/audit.js'
import { computeConfidence } from '../lib/confidence.js'
import { senderTag } from '../lib/hash.js'
import { closePoll, publishReport } from '../pipeline/publish.js'
import { recomputeTally } from '../pipeline/votes.js'

const STATUSES = [
  'DETECTED',
  'PROCESSING',
  'PENDING_VERIFICATION',
  'VOTING',
  'SUPPORTED',
  'DISPUTED',
  'UNCONFIRMED',
  'DISMISSED',
  'VERIFIED',
] as const

const listQuery = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  priority: z.string().optional(),
  since: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
})

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reports', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const q = parsed.data

    const filters = []
    if (q.status) filters.push(inArray(reports.status, q.status.split(',')))
    if (q.category) filters.push(inArray(reports.category, q.category.split(',')))
    if (q.priority) filters.push(inArray(reports.priority, q.priority.split(',')))
    if (q.since) filters.push(gte(reports.createdAt, new Date(q.since)))

    const where = filters.length > 0 ? and(...filters) : undefined

    const rows = await db
      .select()
      .from(reports)
      .where(where)
      .orderBy(desc(reports.createdAt))
      .limit(q.limit)
      .offset(q.offset)

    const [count] = await db
      .select({ total: raw<number>`count(*)::int` })
      .from(reports)
      .where(where)

    return {
      total: count?.total ?? 0,
      reports: rows.map(withConfidence),
    }
  })

  /** Historial completo de un reporte: fuentes, mensajes, votos y evidencia. */
  app.get('/api/reports/:id', async (request, reply) => {
    const id = Number.parseInt((request.params as { id: string }).id, 10)
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido' })

    const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1)
    if (!report) return reply.code(404).send({ error: 'reporte no encontrado' })

    const relatedMessages = await db
      .select({
        id: messages.id,
        sentAt: messages.sentAt,
        content: messages.content,
        summary: messages.summary,
        certainty: messages.certainty,
        category: messages.category,
        priority: messages.priority,
        zone: messages.zone,
        isDuplicate: messages.isDuplicate,
        type: messages.type,
        senderHash: messages.senderHash,
        groupName: monitoredGroups.groupName,
      })
      .from(messages)
      .leftJoin(monitoredGroups, eq(messages.groupId, monitoredGroups.id))
      .where(eq(messages.reportId, id))
      .orderBy(messages.sentAt)

    const voteRows = await db
      .select({ choice: votes.choice, source: votes.source, createdAt: votes.createdAt })
      .from(votes)
      .where(eq(votes.reportId, id))

    const evidenceRows = await db
      .select({
        id: evidence.id,
        kind: evidence.kind,
        content: evidence.content,
        createdAt: evidence.createdAt,
        senderHash: evidence.senderHash,
      })
      .from(evidence)
      .where(eq(evidence.reportId, id))
      .orderBy(desc(evidence.createdAt))

    return {
      report: withConfidence(report),
      // Nunca exponemos el número: sólo un identificador seudónimo estable.
      messages: relatedMessages.map((m) => ({ ...m, source: senderTag(m.senderHash), senderHash: undefined })),
      votes: {
        breakdown: voteRows.reduce<Record<string, number>>((acc, v) => {
          acc[v.choice] = (acc[v.choice] ?? 0) + 1
          return acc
        }, {}),
        bySource: voteRows.reduce<Record<string, number>>((acc, v) => {
          acc[v.source] = (acc[v.source] ?? 0) + 1
          return acc
        }, {}),
      },
      evidence: evidenceRows.map((e) => ({ ...e, source: senderTag(e.senderHash), senderHash: undefined })),
    }
  })

  /** Fuerza la publicación de la encuesta sin esperar al umbral automático. */
  app.post('/api/reports/:id/publish', async (request, reply) => {
    const report = await loadReport(request, reply)
    if (!report) return
    if (report.status === 'VOTING') {
      return reply.code(409).send({ error: 'la encuesta ya está abierta' })
    }
    try {
      await publishReport(report)
    } catch (error) {
      return reply.code(502).send({ error: String(error) })
    }
    return { ok: true }
  })

  app.post('/api/reports/:id/close-poll', async (request, reply) => {
    const report = await loadReport(request, reply)
    if (!report) return
    if (report.status !== 'VOTING') {
      return reply.code(409).send({ error: 'no hay encuesta abierta' })
    }
    await recomputeTally(report.id)
    const [fresh] = await db.select().from(reports).where(eq(reports.id, report.id)).limit(1)
    await closePoll(fresh!)
    return { ok: true }
  })

  app.post('/api/reports/:id/cancel-poll', async (request, reply) => {
    const report = await loadReport(request, reply)
    if (!report) return
    await db
      .update(reports)
      .set({ status: 'DISMISSED', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(reports.id, report.id))
    await audit('POLL_CANCELLED', { entityType: 'report', entityId: report.id, actor: 'admin' })
    return { ok: true }
  })

  const decisionSchema = z.object({
    status: z.enum(STATUSES),
    note: z.string().max(2000).optional(),
  })

  /** Decisión administrativa: VERIFIED, DISMISSED, etc. */
  app.post('/api/reports/:id/status', async (request, reply) => {
    const report = await loadReport(request, reply)
    if (!report) return

    const parsed = decisionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const closing = ['VERIFIED', 'DISMISSED', 'SUPPORTED', 'DISPUTED', 'UNCONFIRMED'].includes(
      parsed.data.status,
    )

    const [row] = await db
      .update(reports)
      .set({
        status: parsed.data.status,
        adminNote: parsed.data.note ?? report.adminNote,
        closedAt: closing ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, report.id))
      .returning()

    await audit(
      parsed.data.status === 'VERIFIED'
        ? 'ADMIN_VERIFIED'
        : parsed.data.status === 'DISMISSED'
          ? 'ADMIN_DISMISSED'
          : 'REPORT_UPDATED',
      {
        entityType: 'report',
        entityId: report.id,
        actor: 'admin',
        detail: { status: parsed.data.status, note: parsed.data.note },
      },
    )

    return { report: withConfidence(row!) }
  })
}

async function loadReport(request: any, reply: any) {
  const id = Number.parseInt(request.params.id, 10)
  if (Number.isNaN(id)) {
    reply.code(400).send({ error: 'id inválido' })
    return null
  }
  const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1)
  if (!report) {
    reply.code(404).send({ error: 'reporte no encontrado' })
    return null
  }
  return report
}

function withConfidence<T extends { votesYes: number; votesNo: number; votesUnknown: number }>(
  report: T,
) {
  return {
    ...report,
    tally: computeConfidence({
      yes: report.votesYes,
      no: report.votesNo,
      unknown: report.votesUnknown,
    }),
  }
}
