import { config } from '../lib/config.js'

export const POLL_OPTIONS = ['✅ Sí', '❌ No', '🤷 No sé'] as const
export type PollOption = (typeof POLL_OPTIONS)[number]

export interface EvolutionGroup {
  id: string
  subject: string
  size?: number
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${config.evolution.baseUrl}${path}`
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      apikey: config.evolution.apiKey,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(45_000),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Evolution ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 400)}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

export const evolution = {
  async fetchInstances(): Promise<unknown[]> {
    const res = await call<unknown>('/instance/fetchInstances')
    return Array.isArray(res) ? res : [res]
  },

  async createInstance(instanceName: string): Promise<unknown> {
    return call('/instance/create', {
      method: 'POST',
      body: {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: false,
        syncFullHistory: false,
      },
    })
  },

  async connect(instanceName: string): Promise<{ base64?: string; code?: string }> {
    return call(`/instance/connect/${instanceName}`)
  },

  async connectionState(instanceName: string): Promise<unknown> {
    return call(`/instance/connectionState/${instanceName}`)
  },

  /** Apunta el webhook de la instancia a nuestro backend. */
  async setWebhook(instanceName: string, url: string, token: string): Promise<unknown> {
    return call(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: {
        webhook: {
          enabled: true,
          url,
          headers: { 'x-webhook-token': token },
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
        },
      },
    })
  },

  async findWebhook(instanceName: string): Promise<unknown> {
    return call(`/webhook/find/${instanceName}`)
  },

  async fetchGroups(instanceName: string): Promise<EvolutionGroup[]> {
    const res = await call<EvolutionGroup[]>(
      `/group/fetchAllGroups/${instanceName}?getParticipants=false`,
    )
    return Array.isArray(res) ? res : []
  },

  async sendText(remoteJid: string, text: string): Promise<{ key?: { id?: string } }> {
    return call(`/message/sendText/${config.evolution.instance}`, {
      method: 'POST',
      body: { number: remoteJid, text, linkPreview: false },
    })
  },

  async sendPoll(
    remoteJid: string,
    question: string,
    options: readonly string[] = POLL_OPTIONS,
  ): Promise<{ key?: { id?: string } }> {
    return call(`/message/sendPoll/${config.evolution.instance}`, {
      method: 'POST',
      body: {
        number: remoteJid,
        name: question.slice(0, 255),
        selectableCount: 1,
        values: [...options],
      },
    })
  },
}
