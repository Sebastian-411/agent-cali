import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '../lib/config.js'
import { sql } from './client.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', 'drizzle')

export async function runMigrations(): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${config.dbSchema}"`)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${config.dbSchema}"._migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const applied = new Set(
    (
      await sql.unsafe<{ name: string }[]>(
        `SELECT name FROM "${config.dbSchema}"._migrations`,
      )
    ).map((row) => row.name),
  )

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const body = readFileSync(join(migrationsDir, file), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO "${config.dbSchema}", public`)
      await tx.unsafe(body)
      await tx.unsafe(`INSERT INTO "${config.dbSchema}"._migrations (name) VALUES ($1)`, [file])
    })
    console.log(`[migrate] aplicada ${file}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => sql.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
