import { and, eq, isNotNull, lte, or } from 'drizzle-orm'

import { db } from '../db/client.js'
import { monitoredGroups, reports } from '../db/schema.js'
import type { Report } from '../db/schema.js'
import { POLL_OPTIONS, evolution } from '../evolution/client.js'
import { audit } from '../lib/audit.js'
import { computeConfidence } from '../lib/confidence.js'
import { config } from '../lib/config.js'

const PRIORITY_ICON: Record<string, string> = {
  CRITICAL: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🟢',
}

export async function notificationGroupJid(): Promise<string | null> {
  const [group] = await db
    .select()
    .from(monitoredGroups)
    .where(and(eq(monitoredGroups.role, 'NOTIFICATION'), eq(monitoredGroups.enabled, true)))
    .limit(1)
  return group?.remoteJid ?? null
}

export function reportCard(report: Report): string {
  const icon = PRIORITY_ICON[report.priority] ?? '⚪'
  const lines = [
    `🚨 REPORTE #${report.id}`,
    '',
    `📍 Zona: ${report.zone ?? 'sin especificar'}`,
    `${icon} Tipo: ${report.category} · Prioridad ${report.priority}`,
  ]

  if (report.occurredApprox) lines.push(`🕒 Hora aproximada: ${report.occurredApprox}`)

  lines.push(
    '',
    report.claim,
    '',
    `Se recibieron ${report.messageCount} mensajes desde ${report.distinctGroups} grupo(s) monitoreado(s).`,
    `Fuentes aparentemente independientes: ${report.independentSources}.`,
  )

  if (report.duplicateCount > 0) {
    lines.push(`Mensajes duplicados o reenviados detectados: ${report.duplicateCount}.`)
  }

  if (report.scamFlag) {
    lines.push(
      '',
      '⚠️ Se detectó una solicitud de dinero o donación cuya legitimidad no ha sido verificada. No transfieras dinero sin confirmar.',
    )
  }

  lines.push(
    '',
    'Esta información NO está confirmada. Responde la encuesta para ayudarnos a verificarla.',
    `Si la encuesta no te funciona, responde en el grupo: "#${report.id} sí", "#${report.id} no" o "#${report.id} no sé".`,
    '',
    'Estado: 🟡 EN VERIFICACIÓN',
  )

  return lines.join('\n')
}

function resultsCard(report: Report): string {
  const result = computeConfidence({
    yes: report.votesYes,
    no: report.votesNo,
    unknown: report.votesUnknown,
  })

  const statusLabel: Record<string, string> = {
    SUPPORTED: '🟢 RESPALDADO POR LA COMUNIDAD',
    DISPUTED: '🔴 DESMENTIDO POR LA COMUNIDAD',
    UNCONFIRMED: '⚪ SIN CONFIRMACIÓN SUFICIENTE',
  }

  return [
    `📊 RESULTADOS · REPORTE #${report.id}`,
    '',
    report.claim,
    '',
    `✅ Sí: ${result.yesPct}% (${report.votesYes})`,
    `❌ No: ${result.noPct}% (${report.votesNo})`,
    `🤷 No sé: ${result.unknownPct}% (${report.votesUnknown})`,
    `Total de respuestas: ${result.total}`,
    '',
    `Nivel de confirmación comunitaria: ${Math.round(result.confidence * 100)}%`,
    `Estado: ${statusLabel[result.status] ?? result.status}`,
    '',
    'Esto refleja lo que reporta la comunidad, no una verificación oficial.',
  ].join('\n')
}

/** Requisito 19: nada se publica hasta que el reporte tenga respaldo mínimo. */
function readyToPublish(report: Report): boolean {
  if (report.priority === 'CRITICAL') return report.messageCount >= 1
  return report.independentSources >= config.pipeline.minSourcesToPublish
}

export async function publishPendingReports(): Promise<number> {
  const jid = await notificationGroupJid()
  if (!jid) return 0

  const pending = await db
    .select()
    .from(reports)
    .where(eq(reports.status, 'PENDING_VERIFICATION'))
    .limit(10)

  let published = 0

  for (const report of pending) {
    if (!readyToPublish(report)) continue
    try {
      await publishReport(report, jid)
      published += 1
    } catch (error) {
      await audit('PIPELINE_ERROR', {
        entityType: 'report',
        entityId: report.id,
        detail: { stage: 'publish', message: String(error) },
      })
    }
  }

  return published
}

export async function publishReport(report: Report, jid?: string): Promise<void> {
  const target = jid ?? (await notificationGroupJid())
  if (!target) throw new Error('No hay grupo de notificaciones configurado')

  await evolution.sendText(target, reportCard(report))
  await audit('ALERT_SENT', { entityType: 'report', entityId: report.id })

  const poll = await evolution.sendPoll(target, report.pollQuestion, POLL_OPTIONS)
  const pollMessageId = poll.key?.id ?? null

  const now = new Date()
  await db
    .update(reports)
    .set({
      status: 'VOTING',
      pollMessageId,
      pollSentAt: now,
      pollClosesAt: new Date(now.getTime() + config.pipeline.pollMinutes * 60_000),
      updatedAt: now,
    })
    .where(eq(reports.id, report.id))

  await audit('POLL_CREATED', {
    entityType: 'report',
    entityId: report.id,
    detail: { pollMessageId, question: report.pollQuestion },
  })
}

export async function closeExpiredPolls(): Promise<number> {
  const now = new Date()
  const expired = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.status, 'VOTING'),
        isNotNull(reports.pollClosesAt),
        lte(reports.pollClosesAt, now),
      ),
    )
    .limit(20)

  for (const report of expired) {
    await closePoll(report)
  }

  return expired.length
}

export async function closePoll(report: Report): Promise<void> {
  const result = computeConfidence({
    yes: report.votesYes,
    no: report.votesNo,
    unknown: report.votesUnknown,
  })

  const updated: Report = { ...report, confidence: result.confidence }

  await db
    .update(reports)
    .set({
      status: result.status,
      confidence: result.confidence,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reports.id, report.id))

  const jid = await notificationGroupJid()
  if (jid) {
    try {
      await evolution.sendText(jid, resultsCard(updated))
    } catch (error) {
      await audit('PIPELINE_ERROR', {
        entityType: 'report',
        entityId: report.id,
        detail: { stage: 'results', message: String(error) },
      })
    }
  }

  await audit('POLL_CLOSED', {
    entityType: 'report',
    entityId: report.id,
    detail: { ...result },
  })
}

/** Reportes que quedaron abiertos sin votos suficientes tras mucho tiempo. */
export async function expireStaleReports(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600_000)
  const result = await db
    .update(reports)
    .set({ status: 'UNCONFIRMED', closedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        or(eq(reports.status, 'PENDING_VERIFICATION'), eq(reports.status, 'VOTING')),
        lte(reports.createdAt, cutoff),
      ),
    )
    .returning({ id: reports.id })
  return result.length
}
