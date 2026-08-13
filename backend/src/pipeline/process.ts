import { and, asc, eq, gte, inArray, isNull, lt, or, sql as raw } from 'drizzle-orm'

import { classifyMessages } from '../agent/classify.js'
import type { ClassifyInput } from '../agent/classify.js'
import { clusterMessages } from '../agent/cluster.js'
import type { ClusterMessageInput, NewCluster, OpenReportInput } from '../agent/cluster.js'
import { db } from '../db/client.js'
import { messages, monitoredGroups, reports } from '../db/schema.js'
import type { Message } from '../db/schema.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'
import { geocodeZone } from '../lib/geo.js'

const PRIORITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

function highestPriority(a: string, b: string): string {
  return (PRIORITY_RANK[a] ?? 0) >= (PRIORITY_RANK[b] ?? 0) ? a : b
}

/**
 * Ciclo de agregación. No genera un reporte por mensaje: espera la ventana de
 * debounce, clasifica el lote completo y luego consolida contra lo que ya está
 * abierto. Requisitos 7, 8, 9, 16 y 19.
 */
export async function processPendingMessages(): Promise<{
  classified: number
  relevant: number
  newReports: number
}> {
  const cutoff = new Date(Date.now() - config.pipeline.debounceSeconds * 1000)

  const pending = await db
    .select()
    .from(messages)
    .where(and(isNull(messages.processedAt), lt(messages.sentAt, cutoff)))
    .orderBy(asc(messages.sentAt))
    .limit(config.pipeline.batchSize)

  if (pending.length === 0) return { classified: 0, relevant: 0, newReports: 0 }

  const groupNames = await loadGroupNames(pending)

  const classifyInput: ClassifyInput[] = pending.map((m, index) => ({
    ref: index,
    group: groupNames.get(m.groupId ?? -1) ?? 'desconocido',
    sentAt: m.sentAt.toISOString(),
    content: m.content,
    hasMedia: m.type !== 'text',
  }))

  const classified = await classifyMessages(classifyInput)
  const now = new Date()

  for (const [index, result] of classified.entries()) {
    const message = pending[index]!
    await db
      .update(messages)
      .set({
        processedAt: now,
        relevant: result.relevant,
        category: result.category,
        priority: result.priority,
        certainty: result.certainty,
        scamSignal: result.scam_signal,
        zone: result.zone || null,
        summary: result.summary || null,
      })
      .where(eq(messages.id, message.id))
  }

  const relevantIndexes = classified
    .map((result, index) => (result.relevant ? index : -1))
    .filter((index) => index >= 0)

  await audit('MESSAGES_CLASSIFIED', {
    detail: { total: pending.length, relevant: relevantIndexes.length },
  })

  if (relevantIndexes.length === 0) {
    return { classified: pending.length, relevant: 0, newReports: 0 }
  }

  const openReports = await loadOpenReports()

  const clusterInput: ClusterMessageInput[] = relevantIndexes.map((index) => {
    const message = pending[index]!
    const result = classified[index]!
    return {
      ref: index,
      group: groupNames.get(message.groupId ?? -1) ?? 'desconocido',
      sentAt: message.sentAt.toISOString(),
      category: result.category,
      certainty: result.certainty,
      zone: result.zone,
      summary: result.summary,
      content: message.content,
    }
  })

  const { assignments, new_clusters } = await clusterMessages(clusterInput, openReports)

  const usedKeys = new Set(
    assignments.filter((a) => a.target === 'new').map((a) => a.new_cluster_key),
  )
  const createdByKey = new Map<string, number>()
  let newReports = 0

  for (const cluster of new_clusters) {
    if (!usedKeys.has(cluster.key)) continue
    const id = await createReport(cluster)
    createdByKey.set(cluster.key, id)
    newReports += 1
  }

  const touched = new Set<number>()

  for (const assignment of assignments) {
    const message = pending[assignment.ref]
    if (!message) continue

    const reportId =
      assignment.target === 'existing'
        ? assignment.existing_report_id
        : createdByKey.get(assignment.new_cluster_key)

    if (!reportId) continue

    const alreadySeen = await isTextDuplicate(reportId, message)

    await db
      .update(messages)
      .set({ reportId, isDuplicate: assignment.duplicate || alreadySeen })
      .where(eq(messages.id, message.id))

    touched.add(reportId)
  }

  for (const reportId of touched) {
    await refreshReportStats(reportId)
  }

  return { classified: pending.length, relevant: relevantIndexes.length, newReports }
}

async function loadGroupNames(batch: Message[]): Promise<Map<number, string>> {
  const ids = [...new Set(batch.map((m) => m.groupId).filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: monitoredGroups.id, name: monitoredGroups.groupName })
    .from(monitoredGroups)
    .where(inArray(monitoredGroups.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}

async function loadOpenReports(): Promise<OpenReportInput[]> {
  const since = new Date(Date.now() - config.pipeline.clusterWindowHours * 3600_000)
  const rows = await db
    .select()
    .from(reports)
    .where(
      and(
        gte(reports.createdAt, since),
        or(
          eq(reports.status, 'PENDING_VERIFICATION'),
          eq(reports.status, 'VOTING'),
          eq(reports.status, 'SUPPORTED'),
          eq(reports.status, 'UNCONFIRMED'),
        ),
      ),
    )
    .orderBy(asc(reports.id))
    .limit(60)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    claim: r.claim,
    category: r.category,
    zone: r.zone,
    createdAt: r.createdAt.toISOString(),
  }))
}

async function createReport(cluster: NewCluster): Promise<number> {
  const coords = geocodeZone(cluster.zone)
  const [row] = await db
    .insert(reports)
    .values({
      title: cluster.title.slice(0, 120),
      claim: cluster.claim,
      pollQuestion: cluster.poll_question,
      category: cluster.category,
      priority: cluster.priority,
      zone: cluster.zone || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      status: 'PENDING_VERIFICATION',
      scamFlag: cluster.scam_flag,
      occurredApprox: cluster.occurred_approx || null,
      clusterKey: cluster.key,
    })
    .returning({ id: reports.id })

  await audit('REPORT_CREATED', {
    entityType: 'report',
    entityId: row!.id,
    detail: { category: cluster.category, priority: cluster.priority, zone: cluster.zone },
  })

  return row!.id
}

/** Detección determinística de reenvíos: mismo texto normalizado en el mismo reporte. */
async function isTextDuplicate(reportId: number, message: Message): Promise<boolean> {
  if (!message.normalizedHash) return false
  const [row] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.reportId, reportId),
        eq(messages.normalizedHash, message.normalizedHash),
        raw`${messages.id} <> ${message.id}::uuid`,
      ),
    )
  return (row?.count ?? 0) > 0
}

/**
 * Recalcula las cifras de trazabilidad del reporte. `independentSources` cuenta
 * remitentes distintos descartando reenvíos: 43 mensajes pueden ser 4 fuentes.
 */
export async function refreshReportStats(reportId: number): Promise<void> {
  const [stats] = await db
    .select({
      total: raw<number>`count(*)::int`,
      duplicates: raw<number>`count(*) filter (where ${messages.isDuplicate})::int`,
      senders: raw<number>`count(distinct ${messages.senderHash})::int`,
      groups: raw<number>`count(distinct ${messages.groupId})::int`,
      independent: raw<number>`count(distinct ${messages.senderHash}) filter (where not ${messages.isDuplicate})::int`,
      maxPriority: raw<string>`max(${messages.priority})`,
      scam: raw<boolean>`bool_or(${messages.scamSignal})`,
    })
    .from(messages)
    .where(eq(messages.reportId, reportId))

  if (!stats) return

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
  if (!report) return

  // max() alfabético no sirve para prioridad; la recalculamos con el ranking.
  const priorities = await db
    .select({ priority: messages.priority })
    .from(messages)
    .where(eq(messages.reportId, reportId))

  let priority = report.priority
  for (const row of priorities) {
    if (row.priority) priority = highestPriority(priority, row.priority)
  }

  await db
    .update(reports)
    .set({
      messageCount: stats.total,
      duplicateCount: stats.duplicates,
      distinctSenders: stats.senders,
      distinctGroups: stats.groups,
      independentSources: stats.independent,
      priority,
      scamFlag: report.scamFlag || Boolean(stats.scam),
      updatedAt: new Date(),
    })
    .where(eq(reports.id, reportId))
}
