const KEY_STORAGE = 'agent-grupos-api-key'

/**
 * Origen del backend. Vacío (el caso por defecto) significa "mismo origen": las
 * llamadas salen a /api y nginx las proxea. Si se define un origen distinto, el
 * backend necesita CORS_ORIGIN configurado.
 *
 * Es una variable de build: Vite la incrusta en el bundle al compilar.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? ''
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key)
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE)
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        // Sólo declaramos JSON cuando de verdad mandamos algo: anunciar
        // application/json con el cuerpo vacío hace que el servidor rechace la
        // petición (FST_ERR_CTP_EMPTY_JSON_BODY).
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'x-api-key': getApiKey(),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(
      API_BASE
        ? `No se pudo contactar al backend en ${API_BASE}. Revisa que esté arriba y que permita este origen (CORS_ORIGIN).`
        : 'No se pudo contactar al backend.',
      0,
    )
  }

  if (response.status === 401) {
    throw new ApiError('Clave de acceso inválida', 401)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new ApiError(body || response.statusText, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
