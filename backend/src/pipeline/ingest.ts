import { and, eq } from 'drizzle-orm'

import { db } from '../db/client.js'
import { messages, monitoredGroups } from '../db/schema.js'
import { hashSender, normalizedHash } from '../lib/hash.js'
import { audit } from '../lib/audit.js'
import { handleTextVote, handlePollUpdate } from './votes.js'

interface EvolutionKey {
  remoteJid?: string
  fromMe?: boolean
  id?: string
  participant?: string
}

export interface EvolutionMessagePayload {
  key?: EvolutionKey
  pushName?: string
  messageType?: string
  messageTimestamp?: number | string
  message?: Record<string, unknown>
  contextInfo?: Record<string, unknown>
}

export interface EvolutionWebhookBody {
  event?: string
  instance?: string
  data?: unknown
}

/** Extrae el texto legible de la unión de tipos de mensaje de WhatsApp. */
export function extractText(message: Record<string, unknown> | undefined): string {
  if (!message) return ''
  const m = message as Record<string, any>
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    m.ephemeralMessage?.message?.conversation ??
    m.ephemeralMessage?.message?.extendedTextMessage?.text ??
    m.viewOnceMessage?.message?.imageMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    ''
  )
}

export function messageKind(message: Record<string, unknown> | undefined): string {
  if (!message) return 'unknown'
  const m = message as Record<string, any>
  if (m.imageMessage) return 'image'
  if (m.videoMessage) return 'video'
  if (m.audioMessage) return 'audio'
  if (m.documentMessage || m.documentWithCaptionMessage) return 'document'
  if (m.stickerMessage) return 'sticker'
  if (m.pollCreationMessage || m.pollCreationMessageV3) return 'poll'
  if (m.pollUpdateMessage) return 'poll_vote'
  return 'text'
}

function quotedMessageId(payload: EvolutionMessagePayload): string | null {
  const m = payload.message as Record<string, any> | undefined
  const ctx =
    m?.extendedTextMessage?.contextInfo ??
    m?.imageMessage?.contextInfo ??
    (payload.contextInfo as Record<string, any> | undefined)
  return ctx?.stanzaId ?? null
}

function toArray(data: unknown): EvolutionMessagePayload[] {
  if (Array.isArray(data)) return data as EvolutionMessagePayload[]
  if (data && typeof data === 'object') {
    const maybe = (data as Record<string, unknown>).messages
    if (Array.isArray(maybe)) return maybe as EvolutionMessagePayload[]
    return [data as EvolutionMessagePayload]
  }
  return []
}

function toDate(timestamp: number | string | undefined): Date {
  if (!timestamp) return new Date()
  const n = typeof timestamp === 'string' ? Number.parseInt(timestamp, 10) : timestamp
  if (Number.isNaN(n)) return new Date()
  // Evolution entrega segundos; algunos builds entregan milisegundos.
  return new Date(n > 1e12 ? n : n * 1000)
}

export async function handleWebhook(body: EvolutionWebhookBody): Promise<{ accepted: number }> {
  const event = (body.event ?? '').toLowerCase().replace('_', '.')
  const payloads = toArray(body.data)
  let accepted = 0

  for (const payload of payloads) {
    if (event === 'messages.update') {
      await handlePollUpdate(payload, body.data)
      continue
    }
    if (event !== 'messages.upsert') continue
    if (payload.key?.fromMe) continue

    const remoteJid = payload.key?.remoteJid
    const waMessageId = payload.key?.id
    if (!remoteJid || !waMessageId) continue
    if (!remoteJid.endsWith('@g.us')) continue // sólo grupos, nunca chats privados

    const [group] = await db
      .select()
      .from(monitoredGroups)
      .where(eq(monitoredGroups.remoteJid, remoteJid))
      .limit(1)

    // Requisito 5: sólo procesamos grupos autorizados explícitamente.
    if (!group || !group.enabled) continue

    const senderJid = payload.key?.participant ?? remoteJid
    const senderHash = hashSender(senderJid)
    const kind = messageKind(payload.message)
    const text = String(extractText(payload.message) ?? '').trim()

    if (kind === 'poll_vote') {
      await handlePollUpdate(payload, body.data)
      continue
    }

    if (group.role === 'NOTIFICATION') {
      // En el grupo central no detectamos hechos: recogemos votos y evidencia.
      await handleTextVote({
        senderHash,
        text,
        quotedMessageId: quotedMessageId(payload),
        kind,
      })
      continue
    }

    if (!text && kind === 'text') continue

    const inserted = await db
      .insert(messages)
      .values({
        waMessageId,
        remoteJid,
        groupId: group.id,
        senderHash,
        senderName: payload.pushName ?? null,
        sentAt: toDate(payload.messageTimestamp),
        type: kind,
        content: text,
        mediaUrl: null,
        normalizedHash: text ? normalizedHash(text) : null,
        raw: null, // ver política de retención en el README
      })
      .onConflictDoNothing()
      .returning({ id: messages.id })

    if (inserted.length > 0) accepted += 1
  }

  if (accepted > 0) {
    await audit('MESSAGE_INGESTED', { detail: { count: accepted, event } })
  }

  return { accepted }
}

/** Utilidad para pruebas y para el endpoint de reproceso manual. */
export async function findGroupByJid(remoteJid: string) {
  const [group] = await db
    .select()
    .from(monitoredGroups)
    .where(and(eq(monitoredGroups.remoteJid, remoteJid)))
    .limit(1)
  return group ?? null
}
