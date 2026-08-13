export interface Tally {
  total: number
  informed: number
  yesPct: number
  noPct: number
  unknownPct: number
  confidence: number
  status: 'SUPPORTED' | 'DISPUTED' | 'UNCONFIRMED'
}

export interface Report {
  id: number
  title: string
  claim: string
  pollQuestion: string
  category: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  zone: string | null
  lat: number | null
  lng: number | null
  status: string
  scamFlag: boolean
  occurredApprox: string | null
  messageCount: number
  duplicateCount: number
  distinctSenders: number
  distinctGroups: number
  independentSources: number
  pollMessageId: string | null
  pollSentAt: string | null
  pollClosesAt: string | null
  votesYes: number
  votesNo: number
  votesUnknown: number
  confidence: number | null
  adminNote: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  tally: Tally
}

export interface ReportMessage {
  id: string
  sentAt: string
  content: string
  summary: string | null
  certainty: string | null
  category: string | null
  priority: string | null
  zone: string | null
  isDuplicate: boolean
  type: string
  groupName: string | null
  source: string
}

export interface ReportDetail {
  report: Report
  messages: ReportMessage[]
  votes: {
    breakdown: Record<string, number>
    bySource: Record<string, number>
  }
  evidence: Array<{
    id: number
    kind: string
    content: string | null
    createdAt: string
    source: string
  }>
}

export interface Group {
  id: number
  remoteJid: string
  groupName: string
  enabled: boolean
  role: 'SOURCE' | 'NOTIFICATION'
  createdAt: string
  updatedAt: string
}

export interface AvailableGroup {
  remoteJid: string
  groupName: string
  size: number | null
  monitored: boolean
  enabled: boolean
  role: string | null
}

export interface Summary {
  reports: {
    critical: number
    high: number
    inVerification: number
    supported: number
    dismissed: number
    byStatus: Record<string, number>
    byCategory: Array<{ category: string; count: number }>
  }
  messages: { total: number; last24h: number; relevant: number; pending: number }
  groups: { total: number; enabled: number }
}

export interface MapPoint {
  id: number
  title: string
  category: string
  priority: string
  status: string
  zone: string | null
  lat: number
  lng: number
  createdAt: string
}

export interface ActivityEntry {
  id: number
  action: string
  entityType: string | null
  entityId: string | null
  actor: string
  detail: unknown
  createdAt: string
}
