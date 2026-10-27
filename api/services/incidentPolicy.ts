export const INCIDENT_SOURCES = ["job", "payout", "reconciliation", "event_quarantine", "support_sla", "dsar_sla", "breach_triage", "fraud_review"] as const;
export type IncidentSource = typeof INCIDENT_SOURCES[number];

export function incidentSeverityForSource(source: IncidentSource) {
  if (["job", "payout", "reconciliation", "breach_triage", "fraud_review"].includes(source)) return "critical" as const;
  return "warning" as const;
}

export function monitoringSlotKey(date: Date) {
  const slot = new Date(date);
  slot.setUTCMinutes(Math.floor(slot.getUTCMinutes() / 5) * 5, 0, 0);
  return slot.toISOString().slice(0, 16);
}
