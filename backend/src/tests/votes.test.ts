import { describe, expect, it } from 'vitest'

import { POLL_OPTIONS } from '../evolution/client.js'
import { pollOptionHash } from '../lib/hash.js'
import { decodeOption, parseChoice } from '../pipeline/votes.js'

describe('votos escritos a mano', () => {
  it('distingue "no sé" de "no"', () => {
    // Regresión: tomar sólo el primer token convertía cada "no sé" en un "no".
    expect(parseChoice('no sé')).toBe('UNKNOWN')
    expect(parseChoice('no se')).toBe('UNKNOWN')
    expect(parseChoice('nose')).toBe('UNKNOWN')
    expect(parseChoice('no lo sé')).toBe('UNKNOWN')
    expect(parseChoice('no')).toBe('NO')
    expect(parseChoice('no es cierto')).toBe('NO')
  })

  it('acepta las variantes de sí', () => {
    expect(parseChoice('sí')).toBe('YES')
    expect(parseChoice('si')).toBe('YES')
    expect(parseChoice('SI confirmado')).toBe('YES')
    expect(parseChoice('1')).toBe('YES')
    expect(parseChoice('confirmo')).toBe('YES')
  })

  it('tolera puntuación', () => {
    expect(parseChoice('sí!')).toBe('YES')
    expect(parseChoice('no.')).toBe('NO')
    expect(parseChoice('no sé...')).toBe('UNKNOWN')
  })

  it('no inventa un voto donde no lo hay', () => {
    expect(parseChoice('')).toBeNull()
    expect(parseChoice('tengo una foto del lugar')).toBeNull()
    expect(parseChoice('gracias por avisar')).toBeNull()
  })
})

describe('votos de encuesta nativa', () => {
  it('resuelve la opción por su hash en hex', () => {
    expect(decodeOption(pollOptionHash(POLL_OPTIONS[0]))).toBe('YES')
    expect(decodeOption(pollOptionHash(POLL_OPTIONS[1]))).toBe('NO')
    expect(decodeOption(pollOptionHash(POLL_OPTIONS[2]))).toBe('UNKNOWN')
  })

  it('resuelve la opción por su hash en base64', () => {
    const base64 = Buffer.from(pollOptionHash(POLL_OPTIONS[2]), 'hex').toString('base64')
    expect(decodeOption(base64)).toBe('UNKNOWN')
  })

  it('resuelve la opción cuando Evolution ya la desencriptó', () => {
    expect(decodeOption(POLL_OPTIONS[0])).toBe('YES')
    expect(decodeOption({ name: POLL_OPTIONS[1] })).toBe('NO')
  })

  it('devuelve null ante algo desconocido', () => {
    expect(decodeOption(undefined)).toBeNull()
    expect(decodeOption('opción que no existe')).toBeNull()
  })
})
