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

export const config = {
  port: int('PORT', 3000),
  dbUrl: process.env.DATABASE_URL ?? '',
  dbSchema: process.env.DB_SCHEMA ?? 'grupos',

  evolution: {
    baseUrl: (process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, ''),
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
    instance: process.env.EVOLUTION_INSTANCE ?? '',
  },

  /** URL pública del backend; Evolution la usa para entregar el webhook. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Token que Evolution devuelve en el webhook para autenticarlo. */
  webhookToken: process.env.WEBHOOK_TOKEN ?? '',
  /** Clave para las rutas de administración del dashboard. */
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  /** Sal para seudonimizar remitentes. Nunca se guardan números en claro. */
  senderSalt: process.env.SENDER_SALT ?? '',
  /**
   * Orígenes autorizados a llamar la API desde el navegador. Vacío = CORS
   * deshabilitado, que es lo correcto cuando el frontend proxea /api por nginx
   * (mismo origen). Sólo hace falta si el panel vive en otro dominio.
   */
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    /** Modelo por defecto para ambas etapas. */
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    /**
     * Modelo por etapa. Clasificar es volumen alto y decisión sencilla; agrupar
     * y redactar el claim es donde conviene gastar. Vacío = usa GEMINI_MODEL.
     */
    classifyModel: process.env.GEMINI_CLASSIFY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    clusterModel: process.env.GEMINI_CLUSTER_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    /** 0 = sin razonamiento, -1 = dinámico, N = presupuesto en tokens. */
    classifyThinkingBudget: int('GEMINI_CLASSIFY_THINKING_BUDGET', 0),
    clusterThinkingBudget: int('GEMINI_CLUSTER_THINKING_BUDGET', -1),
    /** Sólo para apuntar a un proxy o a un endpoint compatible. */
    baseUrl: process.env.GEMINI_BASE_URL ?? '',
  },

  pipeline: {
    /** Cada cuánto corre el ciclo de procesamiento. */
    tickMs: int('PIPELINE_TICK_MS', 60_000),
    /** Ventana de agregación: un mensaje espera esto antes de procesarse. */
    debounceSeconds: int('AGGREGATION_DEBOUNCE_SECONDS', 300),
    /** Máximo de mensajes por ciclo de clasificación. */
    batchSize: int('PIPELINE_BATCH_SIZE', 40),
    /** Ventana en horas para agrupar contra reportes abiertos. */
    clusterWindowHours: int('CLUSTER_WINDOW_HOURS', 8),
    /** Mensajes independientes mínimos para publicar encuesta (salvo CRITICAL). */
    minSourcesToPublish: int('MIN_SOURCES_TO_PUBLISH', 2),
    /** Duración de la encuesta antes de cerrarla y calcular confianza. */
    pollMinutes: int('POLL_OPEN_MINUTES', 90),
    /** Votos informados (Sí+No) mínimos para declarar SUPPORTED/DISPUTED. */
    minInformedVotes: int('MIN_INFORMED_VOTES', 5),
    /** Días de retención de mensajes crudos. 0 = sin borrado automático. */
    retentionDays: int('MESSAGE_RETENTION_DAYS', 30),
    /** Permite apagar el pipeline (útil para pruebas o mantenimiento). */
    enabled: process.env.PIPELINE_ENABLED !== 'false',
  },
} as const

export function assertRuntimeConfig(): void {
  required('DATABASE_URL')
  required('EVOLUTION_API_URL')
  required('EVOLUTION_API_KEY')
  required('EVOLUTION_INSTANCE')
  required('WEBHOOK_TOKEN')
  required('ADMIN_API_KEY')
  required('SENDER_SALT')
  required('GEMINI_API_KEY')
}
