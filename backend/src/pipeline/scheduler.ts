import { and, isNotNull, lt } from 'drizzle-orm'

import { db } from '../db/client.js'
import { messages } from '../db/schema.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'
import { processPendingMessages } from './process.js'
import { closeExpiredPolls, expireStaleReports, publishPendingReports } from './publish.js'

let timer: NodeJS.Timeout | null = null
let running = false

export async function runCycle(): Promise<void> {
  if (running) return
  running = true
  try {
    const processed = await processPendingMessages()
    const published = await publishPendingReports()
    const closed = await closeExpiredPolls()
    await expireStaleReports()
    await purgeOldMessages()

    if (processed.classified > 0 || published > 0 || closed > 0) {
      console.log(
        `[pipeline] clasificados=${processed.classified} relevantes=${processed.relevant} ` +
          `nuevos=${processed.newReports} publicados=${published} cerrados=${closed}`,
      )
    }
  } catch (error) {
    console.error('[pipeline] error', error)
    await audit('PIPELINE_ERROR', { detail: { message: String(error) } }).catch(() => {})
  } finally {
    running = false
  }
}

/** Requisito 24: política de retención de mensajes crudos. */
async function purgeOldMessages(): Promise<void> {
  if (config.pipeline.retentionDays <= 0) return
  const cutoff = new Date(Date.now() - config.pipeline.retentionDays * 86_400_000)
  const deleted = await db
    .delete(messages)
    .where(and(lt(messages.sentAt, cutoff), isNotNull(messages.processedAt)))
    .returning({ id: messages.id })

  if (deleted.length > 0) {
    await audit('RETENTION_PURGE', { detail: { deleted: deleted.length, cutoff } })
  }
}

export function startScheduler(): void {
  if (!config.pipeline.enabled) {
    console.log('[pipeline] deshabilitado por PIPELINE_ENABLED=false')
    return
  }
  if (timer) return
  timer = setInterval(() => void runCycle(), config.pipeline.tickMs)
  console.log(`[pipeline] activo cada ${config.pipeline.tickMs}ms`)
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
