import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { config } from '../lib/config.js'

export const schema = pgSchema(config.dbSchema)

export const monitoredGroups = schema.table('monitored_groups', {
  id: serial('id').primaryKey(),
  remoteJid: text('remote_jid').notNull().unique(),
  groupName: text('group_name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  /** SOURCE = grupo monitoreado. NOTIFICATION = grupo central de reportes. */
  role: text('role').notNull().default('SOURCE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const reports = schema.table(
  'reports',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    claim: text('claim').notNull(),
    pollQuestion: text('poll_question').notNull(),
    category: text('category').notNull(),
    priority: text('priority').notNull().default('MEDIUM'),
    zone: text('zone'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    status: text('status').notNull().default('PENDING_VERIFICATION'),
    scamFlag: boolean('scam_flag').notNull().default(false),
    occurredApprox: text('occurred_approx'),
    clusterKey: text('cluster_key'),
    messageCount: integer('message_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    distinctSenders: integer('distinct_senders').notNull().default(0),
    distinctGroups: integer('distinct_groups').notNull().default(0),
    independentSources: integer('independent_sources').notNull().default(0),
    pollMessageId: text('poll_message_id'),
    pollSentAt: timestamp('poll_sent_at', { withTimezone: true }),
    pollClosesAt: timestamp('poll_closes_at', { withTimezone: true }),
    votesYes: integer('votes_yes').notNull().default(0),
    votesNo: integer('votes_no').notNull().default(0),
    votesUnknown: integer('votes_unknown').notNull().default(0),
    confidence: doublePrecision('confidence'),
    adminNote: text('admin_note'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reports_status_idx').on(t.status),
    index('reports_created_idx').on(t.createdAt),
    index('reports_poll_msg_idx').on(t.pollMessageId),
  ],
)

export const messages = schema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    waMessageId: text('wa_message_id').notNull(),
    remoteJid: text('remote_jid').notNull(),
    groupId: integer('group_id').references(() => monitoredGroups.id, { onDelete: 'set null' }),
    senderHash: text('sender_hash').notNull(),
    senderName: text('sender_name'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    type: text('type').notNull().default('text'),
    content: text('content').notNull().default(''),
    mediaUrl: text('media_url'),
    normalizedHash: text('normalized_hash'),
    raw: jsonb('raw'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    relevant: boolean('relevant'),
    category: text('category'),
    priority: text('priority'),
    certainty: text('certainty'),
    scamSignal: boolean('scam_signal').notNull().default(false),
    zone: text('zone'),
    summary: text('summary'),
    reportId: integer('report_id').references(() => reports.id, { onDelete: 'set null' }),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('messages_wa_message_id_remote_jid_key').on(t.waMessageId, t.remoteJid),
    index('messages_pending_idx').on(t.processedAt, t.sentAt),
    index('messages_report_idx').on(t.reportId),
    index('messages_norm_idx').on(t.normalizedHash),
  ],
)

export const votes = schema.table(
  'votes',
  {
    id: serial('id').primaryKey(),
    reportId: integer('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    voterHash: text('voter_hash').notNull(),
    choice: text('choice').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('votes_report_id_voter_hash_key').on(t.reportId, t.voterHash)],
)

export const evidence = schema.table('evidence', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  senderHash: text('sender_hash').notNull(),
  kind: text('kind').notNull(),
  content: text('content'),
  mediaUrl: text('media_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = schema.table(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    actor: text('actor').notNull().default('system'),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
)

export const settings = schema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Report = typeof reports.$inferSelect
export type Message = typeof messages.$inferSelect
export type MonitoredGroup = typeof monitoredGroups.$inferSelect
