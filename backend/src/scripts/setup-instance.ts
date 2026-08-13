/**
 * Crea (si hace falta) la instancia dedicada de Evolution API, muestra el QR
 * para vincular el WhatsApp del proyecto y apunta el webhook a este backend.
 *
 *   npm run setup:instance
 *
 * Importante: usa una instancia propia. No reutilices una que ya tenga un
 * webhook en producción — Evolution sólo admite un webhook por instancia.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { evolution } from '../evolution/client.js'
import { config } from '../lib/config.js'
import { loadSecrets, secrets } from '../lib/secrets.js'

const QR_PATH = resolve(process.cwd(), 'qr.png')

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function stateOf(payload: unknown): string {
  const node = payload as Record<string, any> | null
  return node?.instance?.state ?? node?.state ?? 'unknown'
}

async function main(): Promise<void> {
  await loadSecrets()
  const name = config.evolution.instance
  if (!name) throw new Error('Falta EVOLUTION_INSTANCE en el .env')

  const instances = (await evolution.fetchInstances()) as Array<Record<string, unknown>>
  const exists = instances.some((i) => i.name === name || i.instanceName === name)

  if (!exists) {
    console.log(`Creando instancia "${name}"...`)
    await evolution.createInstance(name)
  } else {
    console.log(`La instancia "${name}" ya existe.`)
  }

  let connected = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = stateOf(await evolution.connectionState(name).catch(() => null))
    if (state === 'open') {
      connected = true
      break
    }

    const qr = await evolution.connect(name).catch(() => ({}) as { base64?: string; code?: string })
    if (qr.base64) {
      const base64 = qr.base64.replace(/^data:image\/\w+;base64,/, '')
      writeFileSync(QR_PATH, Buffer.from(base64, 'base64'))
      console.log(`\nEscanea el QR: ${QR_PATH}`)
      console.log('(WhatsApp > Dispositivos vinculados > Vincular un dispositivo)')
    }
    if (qr.code) console.log(`Código de vinculación: ${qr.code}`)

    console.log(`Estado: ${state}. Reintentando en 8s... (${attempt + 1}/40)`)
    await sleep(8000)
  }

  if (!connected) {
    console.error('\nLa instancia no se conectó. Vuelve a correr el script cuando escanees el QR.')
    process.exit(1)
  }

  console.log('\n✅ Instancia conectada.')

  if (!config.publicUrl) {
    console.warn(
      'PUBLIC_URL no está definido: no se configuró el webhook.\n' +
        'Expón el backend (ngrok/cloudflared), define PUBLIC_URL y vuelve a correr el script.',
    )
    return
  }

  const url = `${config.publicUrl}/api/webhooks/evolution`
  await evolution.setWebhook(name, url, secrets().webhookToken)
  console.log(`✅ Webhook apuntando a ${url}`)
  console.log('\nSiguiente paso: npm run sync:groups')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
