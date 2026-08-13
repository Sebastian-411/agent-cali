import { describe, expect, it } from 'vitest'

import { computeConfidence } from '../lib/confidence.js'
import { geocodeZone } from '../lib/geo.js'
import { hashSender, normalizeText, normalizedHash, pollOptionHash } from '../lib/hash.js'
import { extractText, messageKind } from '../pipeline/ingest.js'
import { POLL_OPTIONS } from '../evolution/client.js'

describe('confianza comunitaria', () => {
  it('no declara nada con pocos votos informados', () => {
    const result = computeConfidence({ yes: 3, no: 0, unknown: 40 })
    expect(result.status).toBe('UNCONFIRMED')
    expect(result.informed).toBe(3)
  })

  it('respalda cuando la mayoría informada dice que sí', () => {
    const result = computeConfidence({ yes: 82, no: 7, unknown: 31 })
    expect(result.status).toBe('SUPPORTED')
    expect(result.yesPct).toBeCloseTo(68.3, 1)
    expect(result.noPct).toBeCloseTo(5.8, 1)
    expect(result.unknownPct).toBeCloseTo(25.8, 1)
  })

  it('desmiente cuando la mayoría informada dice que no', () => {
    const result = computeConfidence({ yes: 4, no: 30, unknown: 12 })
    expect(result.status).toBe('DISPUTED')
  })

  it('los "no sé" no empujan hacia ningún lado', () => {
    const soloNoSe = computeConfidence({ yes: 0, no: 0, unknown: 100 })
    expect(soloNoSe.status).toBe('UNCONFIRMED')
    expect(soloNoSe.confidence).toBe(0)
  })
})

describe('seudonimización y deduplicación', () => {
  it('el mismo número siempre da el mismo hash, y nunca el número', () => {
    const a = hashSender('573001112233@s.whatsapp.net')
    const b = hashSender('573001112233:12@s.whatsapp.net')
    expect(a).toBe(b)
    expect(a).not.toContain('573001112233')
  })

  it('reconoce reenvíos con distinta puntuación o mayúsculas', () => {
    const original = '¡Están SAQUEANDO el supermercado de la 5ta con 13!'
    const forwarded = 'estan saqueando el supermercado de la 5ta con 13'
    expect(normalizedHash(original)).toBe(normalizedHash(forwarded))
  })

  it('no colapsa mensajes que dicen cosas distintas', () => {
    expect(normalizedHash('saqueo en el norte')).not.toBe(normalizedHash('saqueo en el sur'))
  })

  it('normaliza tildes', () => {
    expect(normalizeText('Anoché húbo saquéo')).toBe('anoche hubo saqueo')
  })
})

describe('opciones de encuesta', () => {
  it('produce un hash distinto y estable por opción', () => {
    const hashes = POLL_OPTIONS.map(pollOptionHash)
    expect(new Set(hashes).size).toBe(3)
    expect(hashes[0]).toMatch(/^[0-9A-F]{64}$/)
    expect(pollOptionHash(POLL_OPTIONS[0])).toBe(hashes[0])
  })
})

describe('extracción de mensajes de WhatsApp', () => {
  it('lee texto plano', () => {
    expect(extractText({ conversation: 'hola' })).toBe('hola')
  })

  it('lee texto extendido y pies de foto', () => {
    expect(extractText({ extendedTextMessage: { text: 'largo' } })).toBe('largo')
    expect(extractText({ imageMessage: { caption: 'foto del saqueo' } })).toBe('foto del saqueo')
  })

  it('clasifica el tipo de mensaje', () => {
    expect(messageKind({ conversation: 'x' })).toBe('text')
    expect(messageKind({ imageMessage: {} })).toBe('image')
    expect(messageKind({ pollUpdateMessage: {} })).toBe('poll_vote')
  })
})

describe('gazetteer', () => {
  it('ubica zonas conocidas', () => {
    expect(geocodeZone('San Fernando, Cali')).not.toBeNull()
    expect(geocodeZone('Florida')).not.toBeNull()
  })

  it('no inventa coordenadas', () => {
    expect(geocodeZone('un lugar que no existe')).toBeNull()
    expect(geocodeZone('')).toBeNull()
    expect(geocodeZone(null)).toBeNull()
  })
})
