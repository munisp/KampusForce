export function supportSlaDue(hours: number, from = new Date()) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("Support SLA must be between 1 and 168 hours");
  return new Date(from.getTime() + hours * 3_600_000);
}

export function isSlaBreached(ticket: { state: string; slaDueAt: Date; slaBreachedAt?: Date | null }, now = new Date()) {
  return Boolean(ticket.slaBreachedAt) || (["vendor_queue", "ops_queue"].includes(ticket.state) && ticket.slaDueAt < now);
}

export function qualityScoreFromCsat(ratings: number[]) {
  if (!ratings.length) return 100;
  if (ratings.some((rating) => !Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error("CSAT ratings must be integers from 1 to 5");
  return Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 20);
}
