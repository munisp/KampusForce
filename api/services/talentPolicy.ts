export function talentTargetProblem(targets: { campusId: number; targetCount: number }[], overallTarget: number) {
  if (!targets.length) return "At least one campus target is required";
  if (new Set(targets.map((target) => target.campusId)).size !== targets.length) return "Each target campus may appear only once";
  if (targets.some((target) => !Number.isInteger(target.targetCount) || target.targetCount < 1)) return "Every campus target must be a positive integer";
  if (targets.reduce((sum, target) => sum + target.targetCount, 0) !== overallTarget) return "Campus targets must add up to the overall campaign target";
  return null;
}

export function assessmentResponsesComplete(questionIds: string[], responses: Record<string, string>) {
  const responseIds = Object.keys(responses);
  return responseIds.length === questionIds.length && new Set(responseIds).size === responseIds.length && questionIds.every((id) => Boolean(responses[id]?.trim()));
}

export function signedOfferResponseProblem(state: string, expiresAt: Date, now = new Date()) {
  if (state !== "issued") return "Offer has already been responded to or is no longer active";
  if (expiresAt <= now) return "Offer response link has expired";
  return null;
}

export function directParticipantAcceptanceAllowed(campaignType: string, currentStage: string) {
  return !["recruitment", "internship", "scholarship", "fellowship"].includes(campaignType) && ["submitted", "screening", "assessment"].includes(currentStage);
}

export function talentCsvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
