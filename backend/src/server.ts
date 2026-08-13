import { buildApp } from './app.js'
import { runMigrations } from './db/migrate.js'
import { assertRuntimeConfig, config } from './lib/config.js'
import { startScheduler, stopScheduler } from './pipeline/scheduler.js'

/**
 * La base suele ser externa y compartida: un reinicio suyo, un despliegue o un
 * corte de red no deberían tumbar el backend. Reintentamos con espera creciente
 * antes de rendirnos.
 */
async function migrateWithRetry(attempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runMigrations()
      return
    } catch (error) {
      if (attempt === attempts) throw error
      const waitMs = Math.min(2_000 * attempt, 15_000)
      console.warn(
        `[db] no se pudo conectar (intento ${attempt}/${attempts}): ${String(error)}. ` +
          `Reintento en ${waitMs / 1000}s`,
      )
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

async function main(): Promise<void> {
  assertRuntimeConfig()
  await migrateWithRetry()

  const app = await buildApp()
  await app.listen({ port: config.port, host: '0.0.0.0' })

  startScheduler()

  const shutdown = async () => {
    stopScheduler()
    await app.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
