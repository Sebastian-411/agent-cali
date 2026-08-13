import { structuredCall } from './gemini.js'
import { CATEGORIES, CERTAINTIES, CLASSIFY_SYSTEM, PRIORITIES } from './prompts.js'
import type { Category, Certainty, Priority } from './prompts.js'
import { config } from '../lib/config.js'

export interface ClassifyInput {
  ref: number
  group: string
  sentAt: string
  content: string
  hasMedia: boolean
}

export interface ClassifyResult {
  ref: number
  relevant: boolean
  category: Category
  priority: Priority
  certainty: Certainty
  scam_signal: boolean
  zone: string
  summary: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer' },
          relevant: { type: 'boolean' },
          category: { type: 'string', enum: [...CATEGORIES] },
          priority: { type: 'string', enum: [...PRIORITIES] },
          certainty: { type: 'string', enum: [...CERTAINTIES] },
          scam_signal: { type: 'boolean' },
          zone: { type: 'string' },
          summary: { type: 'string' },
        },
        required: [
          'ref',
          'relevant',
          'category',
          'priority',
          'certainty',
          'scam_signal',
          'zone',
          'summary',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

export async function classifyMessages(inputs: ClassifyInput[]): Promise<ClassifyResult[]> {
  if (inputs.length === 0) return []

  const user = [
    'Clasifica cada uno de estos mensajes. Devuelve exactamente un item por cada ref recibido.',
    '',
    ...inputs.map((m) =>
      [
        `--- ref ${m.ref} ---`,
        `grupo: ${m.group}`,
        `hora: ${m.sentAt}`,
        `adjunto: ${m.hasMedia ? 'sí' : 'no'}`,
        `texto: ${m.content.slice(0, 1500)}`,
      ].join('\n'),
    ),
  ].join('\n')

  const out = await structuredCall<{ items: ClassifyResult[] }>({
    system: CLASSIFY_SYSTEM,
    user,
    schema: SCHEMA as unknown as Record<string, unknown>,
    model: config.gemini.classifyModel,
    thinkingBudget: config.gemini.classifyThinkingBudget,
  })

  const byRef = new Map(out.items.map((item) => [item.ref, item]))
  return inputs.map(
    (m) =>
      byRef.get(m.ref) ?? {
        ref: m.ref,
        relevant: false,
        category: 'OTRO' as Category,
        priority: 'LOW' as Priority,
        certainty: 'RUMOR' as Certainty,
        scam_signal: false,
        zone: '',
        summary: '',
      },
  )
}
