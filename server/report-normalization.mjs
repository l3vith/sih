const activityCodes = /^(?:p|d|npt|woc|trip|ream|circ|survey)$/i
const routineActivity = /^(?:drill(?:ing)?|circulat(?:e|ing)|condition(?:ing)?|survey|connection|trip(?:ping)?|ream(?:ing)?)\b/i

const eventKinds = [
  [/cement\s+channel(?:ing)?/i, 'Cement channeling'],
  [/cement\s+squeeze/i, 'Cement squeeze'],
  [/(?:mud\s+loss|lost\s+(?:returns|circulation)|returns?\s+low)/i, 'Mud loss / low returns'],
  [/(?:kick|influx)/i, 'Kick / influx'],
  [/stuck[ -]?pipe/i, 'Stuck pipe'],
  [/(?:overpressure|pressure\s+spike)/i, 'Overpressure'],
  [/(?:gas\s+show|elevated\s+gas)/i, 'Gas show'],
  [/(?:well\s+control|shut[ -]?in)/i, 'Well-control action'],
  [/(?:washout|pack[ -]?off)/i, 'Hole problem'],
]

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizedEvent(event) {
  if (!event || typeof event !== 'object') return null
  const originalType = cleanText(event.type)
  const evidence = cleanText(event.evidence)
  const searchable = `${originalType} ${evidence}`
    .replace(/\b(?:no|without)\s+(?:mud\s+)?(?:loss(?:es)?|kick|influx|gas\s+show)\b/gi, '')
  const recognized = eventKinds.find(([pattern]) => pattern.test(searchable))
  const codeOnly = activityCodes.test(originalType) || originalType.length < 3
  const routineOnly = routineActivity.test(originalType) && !recognized
  if ((codeOnly || routineOnly) && !recognized) return null

  const type = recognized?.[1] ?? originalType
  if (!type) return null
  return {
    ...event,
    type,
    time: cleanText(event.time) || null,
    evidence,
    depth: Number.isFinite(Number(event.depth)) ? Number(event.depth) : null,
    severity: ['high', 'medium', 'low'].includes(event.severity) ? event.severity : null,
    mitigation: cleanText(event.mitigation) || null,
  }
}

export function normalizeExtractedReport(report) {
  const source = report && typeof report === 'object' ? report : {}
  const seen = new Set()
  const events = (Array.isArray(source.events) ? source.events : [])
    .map(normalizedEvent)
    .filter(Boolean)
    .filter((event) => {
      const key = `${event.type.toLowerCase()}|${event.time ?? ''}|${event.depth ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { ...source, events }
}
