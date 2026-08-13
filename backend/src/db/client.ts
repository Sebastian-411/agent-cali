import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { config } from '../lib/config.js'

export const sql = postgres(config.dbUrl, {
  max: 10,
  onnotice: () => {},
  connection: { search_path: `${config.dbSchema},public` },
})

export const db = drizzle(sql)
