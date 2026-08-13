import { eq, sql as raw } from 'drizzle-orm'

import { db } from '../db/client.js'
import { evidence, reports, votes } from '../db/schema.js'
import { POLL_OPTIONS } from '../evolution/client.js'
import { audit } from '../lib/audit.js'
import { computeConfidence } from '../lib/confidence.js'
import { normalizeText, pollOptionHash } from '../lib/hash.js'

export type Choice = 'YES' | 'NO' | 'UNKNOWN'

const OPTION_TO_CHOICE: Record<string, Choice> = {
  [POLL_OPTIONS[0]]: 'YES',
  [POLL_OPTIONS[1]]: 'NO',
  [POLL_OPTIONS[2]]: 'UNKNOWN',
}

/** WhatsApp identifica la opción votada por su SHA-256; lo resolvemos aquí. */
const HASH_TO_CHOICE = new Map<string, Choice>(
  POLL_OPTIONS.map((option) => [pollOptionHash(option), OPTION_TO_CHOICE[option]!]),
)

export function decodeOption(value: unknown): Choice | null {
  if (typeof value !== 'string') {
    if (value && typeof value === 'object') {
      const inner = (value as Record<string, unknown>).name ?? (value as Record<string, unknown>).option
      return typeof inner === 'string' ? decodeOption(inner) : null
    }
    return null
  }

  // Caso 1: Evolution ya desencriptó y entrega el texto de la opción.
  const direct = OPTION_TO_CHOICE[value]
  if (direct) return direct

  const normalized = normalizeText(value)
  if (normalized === 'si') return 'YES'
  if (normalized === 'no') return 'NO'
  if (normalized === 'no se' || normalized === 'nose') return 'UNKNOWN'

  // Caso 2: llega el hash de la opción, en hex o base64.
  const hex = /^[0-9a-fA-F]{64}$/.test(value)
    ? value.toUpperCase()
    : Buffer.from(value, 'base64').toString('hex').toUpperCase()
  return HASH_TO_CHOICE.get(hex) ?? null
}

/** Busca recursivamente una clave dentro de un payload de forma desconocida. */
function findDeep(node: unknown, key: string, depth = 0): unknown[] {
  if (depth > 6 || node === null || typeof node !== 'object') return []
  const found: unknown[] = []
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key) found.push(v)
    found.push(...findDeep(v, key, depth + 1))
  }
  return found
}

async function reportByPollMessage(pollMessageId: string) {
  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.pollMessageId, pollMessageId))
    .limit(1)
  return report ?? null
}

export async function recordVote(
  reportId: number,
  voterHash: string,
  choice: Choice,
  source: 'POLL' | 'TEXT',
): Promise<void> {
  await db
    .insert(votes)
    .values({ reportId, voterHash, choice, source })
    .onConflictDoUpdate({
      target: [votes.reportId, votes.voterHash],
      set: { choice, source, updatedAt: new Date() },
    })

  await recomputeTally(reportId)
  await audit('VOTE_RECORDED', {
    entityType: 'report',
    entityId: reportId,
    detail: { choice, source },
  })
}

export async function recomputeTally(reportId: number): Promise<void> {
  const rows = await db
    .select({ choice: votes.choice, count: raw<number>`count(*)::int` })
    .from(votes)
    .where(eq(votes.reportId, reportId))
    .groupBy(votes.choice)

  const tally = { yes: 0, no: 0, unknown: 0 }
  for (const row of rows) {
    if (row.choice === 'YES') tally.yes = row.count
    else if (row.choice === 'NO') tally.no = row.count
    else tally.unknown = row.count
  }

  const result = computeConfidence(tally)
  await db
    .update(reports)
    .set({
      votesYes: tally.yes,
      votesNo: tally.no,
      votesUnknown: tally.unknown,
      confidence: result.confidence,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, reportId))
}

/** Votos que llegan como actualización nativa de encuesta de WhatsApp. */
export async function handlePollUpdate(payload: unknown, rawData: unknown): Promise<void> {
  const candidates = [
    ...findDeep(payload, 'pollUpdates'),
    ...findDeep(rawData, 'pollUpdates'),
  ].flatMap((v) => (Array.isArray(v) ? v : [v]))

  const updates: Array<{ pollMessageId: string | null; voter: string | null; options: unknown[] }> = []

  for (const update of candidates) {
    if (!update || typeof update !== 'object') continue
    const u = update as Record<string, any>
    updates.push({
      pollMessageId: u.pollUpdateMessageKey?.id ?? u.pollCreationMessageKey?.id ?? null,
      voter: u.pollUpdateMessageKey?.participant ?? u.participant ?? null,
      options: u.vote?.selectedOptions ?? u.selectedOptions ?? [],
    })
  }

  // Forma alternativa: messages.upsert con message.pollUpdateMessage.
  for (const node of findDeep(payload, 'pollUpdateMessage')) {
    if (!node || typeof node !== 'object') continue
    const n = node as Record<string, any>
    updates.push({
      pollMessageId: n.pollCreationMessageKey?.id ?? null,
      voter: (payload as any)?.key?.participant ?? null,
      options: n.vote?.selectedOptions ?? [],
    })
  }

  for (const update of updates) {
    if (!update.pollMessageId || !update.voter) continue
    const report = await reportByPollMessage(update.pollMessageId)
    if (!report || report.status !== 'VOTING') continue

    const choice = update.options.map(decodeOption).find((c): c is Choice => c !== null)
    if (!choice) continue

    const { hashSender } = await import('../lib/hash.js')
    await recordVote(report.id, hashSender(update.voter), choice, 'POLL')
  }
}

const VOTE_PATTERNS: Array<{ re: RegExp; choice: Choice }> = [
  { re: /^(si|sí|s|1|yes|confirmo)$/i, choice: 'YES' },
  { re: /^(no|n|2|niego|falso)$/i, choice: 'NO' },
  { re: /^(no se|no sé|nose|ns|3|no lo se|no lo sé|ni idea)$/i, choice: 'UNKNOWN' },
]

/**
 * "no sé" son dos palabras: hay que probar el prefijo de dos tokens ANTES que el
 * de uno, o cada "no sé" se contaría como un "no" y sesgaría el resultado.
 */
export function parseChoice(text: string): Choice | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  const candidates = [tokens.join(' '), tokens.slice(0, 2).join(' '), tokens[0]!]

  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[.,!¡?¿]+$/g, '').trim()
    for (const { re, choice } of VOTE_PATTERNS) {
      if (re.test(cleaned)) return choice
    }
  }
  return null
}

/**
 * Respaldo para cuando los votos nativos de encuesta no llegan desencriptados:
 * la gente puede escribir "#31 sí" en el grupo central, o responder la encuesta.
 */
export async function handleTextVote(input: {
  senderHash: string
  text: string
  quotedMessageId: string | null
  kind: string
}): Promise<void> {
  const text = input.text.trim()
  if (!text) return

  let reportId: number | null = null
  let rest = text
  let explicitTag = false

  const tagged = /^(#?)\s*(\d{1,6})\b[\s:,.-]*(.*)$/s.exec(text)
  if (tagged) {
    explicitTag = tagged[1] === '#'
    reportId = Number.parseInt(tagged[2]!, 10)
    rest = tagged[3] ?? ''
  } else if (input.quotedMessageId) {
    const report = await reportByPollMessage(input.quotedMessageId)
    if (report) reportId = report.id
  }

  if (reportId === null) return

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
  if (!report) return

  const choice = parseChoice(rest)

  // "3 heridos en la vía" empieza con un número pero no es un voto ni evidencia
  // del reporte 3. Sin "#" explícito ni cita, no lo atribuimos a nadie.
  if (!choice && !explicitTag && !input.quotedMessageId) return

  if (choice) {
    if (report.status !== 'VOTING') return
    await recordVote(report.id, input.senderHash, choice, 'TEXT')
    return
  }

  // No es un voto: lo tratamos como evidencia o aporte adicional.
  const body = rest.trim()
  if (!body && input.kind === 'text') return

  await db.insert(evidence).values({
    reportId: report.id,
    senderHash: input.senderHash,
    kind: input.kind === 'image' ? 'PHOTO' : input.kind === 'video' ? 'VIDEO' : 'TEXT',
    content: body.slice(0, 2000) || null,
    mediaUrl: null,
  })

  await audit('EVIDENCE_ADDED', { entityType: 'report', entityId: report.id })
}
