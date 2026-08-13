import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { secrets } from './secrets.js'

/**
 * Seudonimiza un remitente. El número real nunca se persiste ni se publica:
 * lo único que guardamos es este HMAC, que basta para contar fuentes
 * independientes y para deduplicar votos.
 */
export function hashSender(jid: string): string {
  const normalized = jid.split(':')[0]!.split('@')[0]!.replace(/\D/g, '')
  return createHmac('sha256', secrets().senderSalt).update(normalized).digest('hex').slice(0, 32)
}

/** Últimos 2 dígitos, sólo para que un admin distinga fuentes en la UI. */
export function senderTag(hash: string): string {
  return hash.slice(0, 6)
}

/** Normaliza texto para detectar mensajes reenviados / copiados. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizedHash(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex').slice(0, 32)
}

/** WhatsApp identifica las opciones de encuesta por SHA-256 del texto. */
export function pollOptionHash(option: string): string {
  return createHash('sha256').update(Buffer.from(option, 'utf8')).digest('hex').toUpperCase()
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
