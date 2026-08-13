function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name}`)
  return value
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) throw new Error(`${name} debe ser un entero`)
  return parsed
}

/**
 * Sólo 7 variables son obligatorias (ver assertRuntimeConfig). Todo lo demás
 * tiene un valor por defecto razonable y se puede ignorar hasta que haga falta
 * ajustarlo; se sigue pudiendo sobreescribir por entorno.
 */
export const config = {
  port: int('PORT', 3000),
  dbUrl: process.env.DATABASE_URL ?? '',
  /** La base puede estar compartida: todo vive dentro de este esquema. */
  dbSchema: process.env.DB_SCHEMA ?? 'agente_grupos',

  evolution: {
    baseUrl: (process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, ''),
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
    instance: process.env.EVOLUTION_INSTANCE ?? '',
  },

  /** URL pública del backend; Evolution la usa para entregar el webhook. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Clave para el panel y toda la API de administración. */
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  /**
   * Orígenes autorizados a llamar la API desde el navegador. Vacío = CORS
   * deshabilitado, que es lo correcto cuando el panel proxea /api por nginx.
   */
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    /** Modelo por etapa. Vacío = usa GEMINI_MODEL. */
    classifyModel:
      process.env.GEMINI_CLASSIFY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    clusterModel:
      process.env.GEMINI_CLUSTER_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    /** 0 = sin razonamiento, -1 = dinámico, N = presupuesto en tokens. */
    classifyThinkingBudget: int('GEMINI_CLASSIFY_THINKING_BUDGET', 0),
    clusterThinkingBudget: int('GEMINI_CLUSTER_THINKING_BUDGET', -1),
    /** Sólo para apuntar a un proxy o endpoint compatible. */
    baseUrl: process.env.GEMINI_BASE_URL ?? '',
  },

  pipeline: {
    tickMs: int('PIPELINE_TICK_MS', 60_000),
    /** Ventana de agregación: un mensaje espera esto antes de procesarse. */
    debounceSeconds: int('AGGREGATION_DEBOUNCE_SECONDS', 300),
    batchSize: int('PIPELINE_BATCH_SIZE', 40),
    clusterWindowHours: int('CLUSTER_WINDOW_HOURS', 8),
    /** Fuentes independientes para publicar encuesta (salvo CRITICAL). */
    minSourcesToPublish: int('MIN_SOURCES_TO_PUBLISH', 2),
    pollMinutes: int('POLL_OPEN_MINUTES', 90),
    /** Votos informados (Sí+No) mínimos para SUPPORTED/DISPUTED. */
    minInformedVotes: int('MIN_INFORMED_VOTES', 5),
    /** Días de retención de mensajes crudos. 0 = sin borrado automático. */
    retentionDays: int('MESSAGE_RETENTION_DAYS', 30),
    /** Apaga el procesamiento sin apagar la ingesta ni la API. */
    enabled: process.env.PIPELINE_ENABLED !== 'false',
  },
} as const

/**
 * Las únicas que no se pueden adivinar. WEBHOOK_TOKEN y SENDER_SALT no están
 * aquí: se generan solos en el primer arranque (ver lib/secrets.ts).
 */
export function assertRuntimeConfig(): void {
  required('DATABASE_URL')
  required('EVOLUTION_API_URL')
  required('EVOLUTION_API_KEY')
  required('EVOLUTION_INSTANCE')
  required('PUBLIC_URL')
  required('ADMIN_API_KEY')
  required('GEMINI_API_KEY')
}
