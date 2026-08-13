/**
 * Lista los grupos visibles por la instancia y los registra como candidatos a
 * monitoreo, DESHABILITADOS por defecto. Ningún grupo se lee hasta que un
 * administrador lo habilita explícitamente (requisito 5 y 24).
 *
 *   npm run sync:groups
 */
import { db, sql } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { monitoredGroups } from '../db/schema.js'
import { evolution } from '../evolution/client.js'
import { config } from '../lib/config.js'

async function main(): Promise<void> {
  await runMigrations()

  const groups = await evolution.fetchGroups(config.evolution.instance)
  console.log(`Se encontraron ${groups.length} grupos en la instancia.\n`)

  for (const group of groups) {
    const [row] = await db
      .insert(monitoredGroups)
      .values({ remoteJid: group.id, groupName: group.subject, enabled: false, role: 'SOURCE' })
      .onConflictDoUpdate({
        target: monitoredGroups.remoteJid,
        set: { groupName: group.subject, updatedAt: new Date() },
      })
      .returning()

    const flag = row!.enabled ? `MONITOREADO (${row!.role})` : 'ignorado'
    console.log(`  ${row!.id}\t${group.id}\t${group.subject}\t-> ${flag}`)
  }

  console.log(
    '\nHabilita los grupos desde el dashboard, o con:\n' +
      "  curl -X PATCH $API/api/groups/<id> -H 'x-api-key: ...' -H 'content-type: application/json' \\\n" +
      '       -d \'{"enabled":true,"role":"SOURCE"}\'\n' +
      'Marca el grupo central de notificaciones con "role":"NOTIFICATION".',
  )
}

main()
  .then(() => sql.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
