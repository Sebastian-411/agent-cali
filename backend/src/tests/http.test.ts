import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Regresión: los botones del panel (configurar webhook, sincronizar grupos,
 * forzar un ciclo) hacen POST sin cuerpo. Si el servidor rechaza esa forma,
 * fallan con FST_ERR_CTP_EMPTY_JSON_BODY y el usuario no puede terminar la
 * puesta en marcha.
 */
describe('POST sin cuerpo con content-type json', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    // Mismo parser que registra buildApp().
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        const text = typeof body === 'string' ? body.trim() : ''
        if (text === '') return done(null, {})
        try {
          done(null, JSON.parse(text))
        } catch (error) {
          ;(error as Error & { statusCode?: number }).statusCode = 400
          done(error as Error, undefined)
        }
      },
    )
    app.post('/accion', async (request) => ({ ok: true, body: request.body }))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('acepta el cuerpo vacío y lo trata como objeto vacío', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accion',
      headers: { 'content-type': 'application/json' },
      payload: '',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, body: {} })
  })

  it('acepta el cuerpo con sólo espacios', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accion',
      headers: { 'content-type': 'application/json' },
      payload: '   ',
    })
    expect(res.statusCode).toBe(200)
  })

  it('sigue parseando un cuerpo normal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accion',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ enabled: true }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().body).toEqual({ enabled: true })
  })

  it('sigue rechazando un JSON malformado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accion',
      headers: { 'content-type': 'application/json' },
      payload: '{roto',
    })
    expect(res.statusCode).toBe(400)
  })
})
