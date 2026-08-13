import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai'

import { config } from '../lib/config.js'

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: config.gemini.apiKey,
      ...(config.gemini.baseUrl ? { httpOptions: { baseUrl: config.gemini.baseUrl } } : {}),
    })
  }
  return client
}

/**
 * El corpus que analiza este sistema son reportes de saqueos, presencia de
 * grupos armados y emergencias: con los umbrales por defecto, el filtro de
 * seguridad bloquearía justo los mensajes que hay que clasificar. Aquí no se
 * genera contenido dañino, se clasifica texto ajeno para alertar a la comunidad.
 */
const SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }))

export interface StructuredCallOptions {
  system: string
  user: string
  schema: Record<string, unknown>
  model: string
  /** 0 = sin razonamiento, -1 = dinámico, N = presupuesto en tokens. */
  thinkingBudget: number
  maxOutputTokens?: number
}

/**
 * Una sola llamada al modelo con salida estructurada garantizada por esquema.
 * Devuelve el objeto ya parseado.
 */
export async function structuredCall<T>(opts: StructuredCallOptions): Promise<T> {
  const response = await getClient().models.generateContent({
    model: opts.model,
    contents: opts.user,
    config: {
      systemInstruction: opts.system,
      responseMimeType: 'application/json',
      // responseJsonSchema acepta JSON Schema estándar (incluye
      // additionalProperties y required); responseSchema, el subconjunto de
      // OpenAPI, no los admite.
      responseJsonSchema: opts.schema,
      thinkingConfig: { thinkingBudget: opts.thinkingBudget },
      maxOutputTokens: opts.maxOutputTokens ?? 32_000,
      safetySettings: SAFETY_SETTINGS,
      abortSignal: AbortSignal.timeout(180_000),
    },
  })

  const blockReason = response.promptFeedback?.blockReason
  if (blockReason) {
    throw new Error(`Gemini bloqueó la petición (${blockReason})`)
  }

  const candidate = response.candidates?.[0]
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error(
        'Respuesta truncada por maxOutputTokens; reduce PIPELINE_BATCH_SIZE',
      )
    }
    throw new Error(`Gemini terminó con ${candidate.finishReason}`)
  }

  const text = response.text
  if (!text) throw new Error('Gemini no devolvió texto')

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Gemini devolvió un JSON inválido: ${text.slice(0, 200)}`)
  }
}
