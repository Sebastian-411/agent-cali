import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { db } from '../db/client.js'
import { settings } from '../db/schema.js'

export interface Secrets {
  /** Token con el que Evolution se autentica al entregar el webhook. */
  webhookToken: string
  /** Sal para seudonimizar remitentes. Nunca se guardan números en claro. */
  senderSalt: string
}

let cache: Secrets | null = null

/**
 * Estos dos secretos nunca los escribe una persona: uno lo usa Evolution y el
 * otro es interno. En vez de obligar a generarlos a mano, se crean solos la
 * primera vez y quedan guardados junto a los datos que protegen.
 *
 * Si vienen por entorno, mandan esos: así un despliegue existente no cambia de
 * comportamiento y se pueden fijar cuando haga falta.
 */
async function getOrCreate(key: string): Promise<{ value: string; created: boolean }> {
  const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  if (existing) return { value: String(existing.value), created: false }

  const value = randomBytes(32).toString('hex')
  await db
    .insert(settings)
    .values({ key, value: value as never })
    .onConflictDoNothing()

  // Si otra instancia lo creó a la vez, gana la suya.
  const [stored] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return { value: String(stored?.value ?? value), created: true }
}

export async function loadSecrets(): Promise<{ generated: string[] }> {
  const generated: string[] = []

  let webhookToken = process.env.WEBHOOK_TOKEN ?? ''
  if (!webhookToken) {
    const result = await getOrCreate('webhook_token')
    webhookToken = result.value
    if (result.created) generated.push('WEBHOOK_TOKEN')
  }

  let senderSalt = process.env.SENDER_SALT ?? ''
  if (!senderSalt) {
    const result = await getOrCreate('sender_salt')
    senderSalt = result.value
    if (result.created) generated.push('SENDER_SALT')
  }

  cache = { webhookToken, senderSalt }
  return { generated }
}

export function secrets(): Secrets {
  if (!cache) throw new Error('Secretos no inicializados: falta llamar a loadSecrets()')
  return cache
}

/** Para pruebas y scripts que no levantan el servidor completo. */
export function setSecrets(value: Secrets): void {
  cache = value
}
