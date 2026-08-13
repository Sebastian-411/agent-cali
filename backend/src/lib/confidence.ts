import { config } from './config.js'

export interface VoteTally {
  yes: number
  no: number
  unknown: number
}

export interface ConfidenceResult {
  total: number
  informed: number
  yesPct: number
  noPct: number
  unknownPct: number
  /** Proporción de "Sí" entre quienes sí tenían información. */
  confidence: number
  status: 'SUPPORTED' | 'DISPUTED' | 'UNCONFIRMED'
}

/**
 * Esto NO es "verdad". Es el nivel de confirmación comunitaria: cuánta gente que
 * dice tener información respalda o desmiente la afirmación.
 */
export function computeConfidence(tally: VoteTally): ConfidenceResult {
  const total = tally.yes + tally.no + tally.unknown
  const informed = tally.yes + tally.no
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10)
  const confidence = informed === 0 ? 0 : tally.yes / informed

  let status: ConfidenceResult['status'] = 'UNCONFIRMED'
  if (informed >= config.pipeline.minInformedVotes) {
    if (confidence >= 0.65) status = 'SUPPORTED'
    else if (confidence <= 0.35) status = 'DISPUTED'
  }

  return {
    total,
    informed,
    yesPct: pct(tally.yes),
    noPct: pct(tally.no),
    unknownPct: pct(tally.unknown),
    confidence: Math.round(confidence * 1000) / 1000,
    status,
  }
}
