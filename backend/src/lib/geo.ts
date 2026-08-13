import { normalizeText } from './hash.js'

/**
 * Gazetteer mínimo de Cali y el norte del Valle. Sirve para poner un marcador
 * aproximado en el mapa del dashboard cuando el agente extrae una zona conocida.
 * No es geocodificación: si no hay coincidencia, el reporte simplemente no
 * aparece en el mapa y sí en la lista.
 */
const PLACES: Array<{ names: string[]; lat: number; lng: number }> = [
  { names: ['cali', 'santiago de cali'], lat: 3.4516, lng: -76.532 },
  { names: ['san fernando'], lat: 3.4234, lng: -76.5432 },
  { names: ['el centro', 'centro de cali'], lat: 3.4516, lng: -76.5322 },
  { names: ['siloe', 'siloé'], lat: 3.4325, lng: -76.5601 },
  { names: ['aguablanca', 'distrito de aguablanca'], lat: 3.4185, lng: -76.4776 },
  { names: ['el poblado'], lat: 3.4292, lng: -76.4864 },
  { names: ['ciudad cordoba', 'ciudad córdoba'], lat: 3.4082, lng: -76.4909 },
  { names: ['meléndez', 'melendez'], lat: 3.3841, lng: -76.5388 },
  { names: ['valle del lili'], lat: 3.3706, lng: -76.5251 },
  { names: ['ciudad jardin', 'ciudad jardín'], lat: 3.3663, lng: -76.5372 },
  { names: ['granada'], lat: 3.4587, lng: -76.5379 },
  { names: ['la flora'], lat: 3.4869, lng: -76.5262 },
  { names: ['terron colorado', 'terrón colorado'], lat: 3.4623, lng: -76.5555 },
  { names: ['juanchito'], lat: 3.4489, lng: -76.4508 },
  { names: ['navarro'], lat: 3.3925, lng: -76.4645 },
  { names: ['yumbo'], lat: 3.5813, lng: -76.4917 },
  { names: ['jamundi', 'jamundí'], lat: 3.2611, lng: -76.5397 },
  { names: ['palmira'], lat: 3.5394, lng: -76.3036 },
  { names: ['candelaria'], lat: 3.4092, lng: -76.3486 },
  { names: ['florida'], lat: 3.3225, lng: -76.2361 },
  { names: ['pradera'], lat: 3.4194, lng: -76.2419 },
  { names: ['buga', 'guadalajara de buga'], lat: 3.9006, lng: -76.2978 },
  { names: ['tulua', 'tuluá'], lat: 4.0847, lng: -76.1954 },
  { names: ['buenaventura'], lat: 3.8801, lng: -77.0312 },
  { names: ['cartago'], lat: 4.7464, lng: -75.9117 },
  { names: ['roldanillo'], lat: 4.4131, lng: -76.1544 },
  { names: ['zarzal'], lat: 4.3939, lng: -76.0722 },
  { names: ['la union', 'la unión'], lat: 4.5347, lng: -76.1017 },
  { names: ['toro'], lat: 4.6086, lng: -76.0783 },
  { names: ['obando'], lat: 4.5764, lng: -75.9772 },
  { names: ['la victoria'], lat: 4.5233, lng: -76.0369 },
  { names: ['bolivar', 'bolívar'], lat: 4.3383, lng: -76.1858 },
  { names: ['sevilla'], lat: 4.2711, lng: -75.9339 },
  { names: ['caicedonia'], lat: 4.3325, lng: -75.8317 },
  { names: ['ansermanuevo'], lat: 4.7961, lng: -75.9917 },
  { names: ['el dovio'], lat: 4.5108, lng: -76.2367 },
  { names: ['versalles'], lat: 4.5764, lng: -76.2003 },
  { names: ['el cairo'], lat: 4.7625, lng: -76.2222 },
  { names: ['argelia'], lat: 4.7264, lng: -76.1194 },
  { names: ['alcala', 'alcalá'], lat: 4.6742, lng: -75.7789 },
  { names: ['ulloa'], lat: 4.7025, lng: -75.7369 },
]

export function geocodeZone(zone: string | null | undefined): { lat: number; lng: number } | null {
  if (!zone) return null
  const normalized = normalizeText(zone)
  if (!normalized) return null

  for (const place of PLACES) {
    for (const name of place.names) {
      const target = normalizeText(name)
      if (normalized === target || normalized.includes(` ${target} `) ||
          normalized.startsWith(`${target} `) || normalized.endsWith(` ${target}`)) {
        return { lat: place.lat, lng: place.lng }
      }
    }
  }
  return null
}
