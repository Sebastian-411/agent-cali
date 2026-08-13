import { structuredCall } from './gemini.js'
import { CATEGORIES, CLUSTER_SYSTEM, PRIORITIES } from './prompts.js'
import type { Category, Priority } from './prompts.js'
import { config } from '../lib/config.js'

export interface ClusterMessageInput {
  ref: number
  group: string
  sentAt: string
  category: string
  certainty: string
  zone: string
  summary: string
  content: string
}

export interface OpenReportInput {
  id: number
  title: string
  claim: string
  category: string
  zone: string | null
  createdAt: string
}

export interface Assignment {
  ref: number
  target: 'existing' | 'new'
  existing_report_id: number
  new_cluster_key: string
  duplicate: boolean
}

export interface NewCluster {
  key: string
  title: string
  claim: string
  poll_question: string
  category: Category
  priority: Priority
  zone: string
  occurred_approx: string
  scam_flag: boolean
}

const SCHEMA = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer' },
          target: { type: 'string', enum: ['existing', 'new'] },
          // 0 cuando target = "new". Evitamos nulls a propósito.
          existing_report_id: { type: 'integer' },
          // Cadena vacía cuando target = "existing".
          new_cluster_key: { type: 'string' },
          duplicate: { type: 'boolean' },
        },
        required: ['ref', 'target', 'existing_report_id', 'new_cluster_key', 'duplicate'],
        additionalProperties: false,
      },
    },
    new_clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          claim: { type: 'string' },
          poll_question: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          priority: { type: 'string', enum: [...PRIORITIES] },
          zone: { type: 'string' },
          occurred_approx: { type: 'string' },
          scam_flag: { type: 'boolean' },
        },
        required: [
          'key',
          'title',
          'claim',
          'poll_question',
          'category',
          'priority',
          'zone',
          'occurred_approx',
          'scam_flag',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['assignments', 'new_clusters'],
  additionalProperties: false,
} as const

export async function clusterMessages(
  messages: ClusterMessageInput[],
  openReports: OpenReportInput[],
): Promise<{ assignments: Assignment[]; new_clusters: NewCluster[] }> {
  if (messages.length === 0) return { assignments: [], new_clusters: [] }

  const reportsBlock =
    openReports.length === 0
      ? '(no hay reportes abiertos)'
      : openReports
          .map(
            (r) =>
              `id ${r.id} | ${r.category} | zona: ${r.zone ?? '-'} | abierto: ${r.createdAt}\n  claim: ${r.claim}`,
          )
          .join('\n')

  const user = [
    'REPORTES ABIERTOS:',
    reportsBlock,
    '',
    'MENSAJES RELEVANTES NUEVOS:',
    ...messages.map((m) =>
      [
        `--- ref ${m.ref} ---`,
        `grupo: ${m.group}`,
        `hora: ${m.sentAt}`,
        `categoría: ${m.category} | certeza: ${m.certainty} | zona: ${m.zone || '-'}`,
        `resumen: ${m.summary}`,
        `texto: ${m.content.slice(0, 1200)}`,
      ].join('\n'),
    ),
    '',
    'Devuelve una asignación por cada ref y un objeto en new_clusters por cada clave nueva usada.',
  ].join('\n')

  const out = await structuredCall<{ assignments: Assignment[]; new_clusters: NewCluster[] }>({
    system: CLUSTER_SYSTEM,
    user,
    schema: SCHEMA as unknown as Record<string, unknown>,
    model: config.gemini.clusterModel,
    thinkingBudget: config.gemini.clusterThinkingBudget,
  })

  const validIds = new Set(openReports.map((r) => r.id))
  const validKeys = new Set(out.new_clusters.map((c) => c.key))

  // Descartamos asignaciones que apunten a algo que no existe.
  const assignments = out.assignments.filter((a) =>
    a.target === 'existing' ? validIds.has(a.existing_report_id) : validKeys.has(a.new_cluster_key),
  )

  return { assignments, new_clusters: out.new_clusters }
}
