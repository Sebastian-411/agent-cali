import { db } from '../db/client.js'
import { auditLog } from '../db/schema.js'

export type AuditAction =
  | 'MESSAGE_INGESTED'
  | 'MESSAGES_CLASSIFIED'
  | 'REPORT_CREATED'
  | 'REPORT_UPDATED'
  | 'POLL_CREATED'
  | 'POLL_CLOSED'
  | 'POLL_CANCELLED'
  | 'VOTE_RECORDED'
  | 'EVIDENCE_ADDED'
  | 'ALERT_SENT'
  | 'ADMIN_VERIFIED'
  | 'ADMIN_DISMISSED'
  | 'GROUP_ENABLED'
  | 'GROUP_DISABLED'
  | 'GROUP_ADDED'
  | 'SETTING_UPDATED'
  | 'RETENTION_PURGE'
  | 'PIPELINE_ERROR'

export async function audit(
  action: AuditAction,
  opts: {
    entityType?: string
    entityId?: string | number
    actor?: string
    detail?: unknown
  } = {},
): Promise<void> {
  await db.insert(auditLog).values({
    action,
    entityType: opts.entityType ?? null,
    entityId: opts.entityId === undefined ? null : String(opts.entityId),
    actor: opts.actor ?? 'system',
    detail: (opts.detail ?? null) as never,
  })
}
