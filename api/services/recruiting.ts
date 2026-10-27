import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campusLeadAssignments,
  campusRecruitments,
  campuses,
  deals,
  reps,
  users,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { notifyUser } from "./notifications";
import { randomReference } from "./security";

export const hashInvitationToken = (token: string) => createHash("sha256").update(`kf-recruit:${token}`).digest("hex");
export const createInvitationToken = () => randomBytes(32).toString("base64url");

export async function inspectRecruitment(token: string) {
  const [row] = await getDb().select({ recruitment: campusRecruitments, campus: campuses, lead: reps, leadUser: users })
    .from(campusRecruitments)
    .innerJoin(campuses, eq(campusRecruitments.campusId, campuses.id))
    .innerJoin(reps, eq(campusRecruitments.leadRepId, reps.id))
    .innerJoin(users, eq(reps.userId, users.id))
    .where(eq(campusRecruitments.tokenHash, hashInvitationToken(token))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This invitation is invalid or no longer available" });
  const expired = row.recruitment.status === "invited" && row.recruitment.expiresAt <= new Date();
  return {
    campus: { name: row.campus.name, state: row.campus.state },
    leadName: row.leadUser.name,
    recruitName: row.recruitment.name,
    status: expired ? "expired" as const : row.recruitment.status,
    expiresAt: row.recruitment.expiresAt,
  };
}

export async function acceptRecruitment(userId: number, token: string, contractorAgreementAccepted: boolean) {
  if (!contractorAgreementAccepted) throw new TRPCError({ code: "BAD_REQUEST", message: "Accept the independent-contractor terms to continue" });
  const result = await getDb().transaction(async (tx) => {
    const [invitation] = await tx.select().from(campusRecruitments)
      .where(eq(campusRecruitments.tokenHash, hashInvitationToken(token))).limit(1).for("update");
    if (!invitation) throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found" });
    if (invitation.status !== "invited" || invitation.expiresAt <= new Date()) {
      if (invitation.status === "invited") await tx.update(campusRecruitments).set({ status: "expired" }).where(eq(campusRecruitments.id, invitation.id));
      throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has expired, been revoked, or already been used" });
    }
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.role !== "rep" || user.phoneE164 !== invitation.phoneE164) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sign in with the exact phone number invited by the Campus Lead" });
    }
    let [rep] = await tx.select().from(reps).where(eq(reps.userId, user.id)).limit(1);
    if (rep) {
      if (rep.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "This account already has an activated rep profile" });
      const existingDeals = await tx.select({ id: deals.id }).from(deals).where(eq(deals.repId, rep.id)).limit(1);
      if (existingDeals.length) throw new TRPCError({ code: "CONFLICT", message: "A pending rep with deal history cannot change campus through an invitation" });
      const now = new Date();
      await tx.update(reps).set({ campusId: invitation.campusId, contractorAgreementSignedAt: now }).where(eq(reps.id, rep.id));
    } else {
      const [{ id }] = await tx.insert(reps).values({
        userId: user.id,
        campusId: invitation.campusId,
        code: randomReference("KF").replace("_", "-").toUpperCase(),
        status: "pending",
        contractorAgreementSignedAt: new Date(),
      }).returning({ id: reps.id });
      [rep] = await tx.select().from(reps).where(eq(reps.id, id)).limit(1);
    }
    const acceptedAt = new Date();
    await tx.update(campusRecruitments).set({ status: "accepted", acceptedAt, acceptedUserId: user.id }).where(eq(campusRecruitments.id, invitation.id));
    await tx.insert(auditLogs).values({ actorUserId: user.id, action: "recruitment.accepted", entityType: "campus_recruitment", entityId: String(invitation.id), metadataJson: { repId: rep.id, campusId: invitation.campusId, contractorAgreementAccepted: true } });
    return { recruitmentId: invitation.id, repId: rep.id, leadRepId: invitation.leadRepId, acceptedAt };
  });
  const [lead] = await getDb().select({ userId: reps.userId }).from(reps).where(eq(reps.id, result.leadRepId)).limit(1);
  if (lead) await notifyUser({ userId: lead.userId, type: "recruitment_accepted", title: "Recruit accepted the invitation", body: "The contractor terms were accepted. Operations can now complete identity activation.", href: "/rep/team", entityType: "campus_recruitment", entityId: result.recruitmentId });
  return { recruitmentId: result.recruitmentId, repId: result.repId, status: "accepted" as const, nextStep: "operations_identity_activation" };
}

export async function revokeRecruitment(input: { recruitmentId: number; actorUserId: number; leadRepId?: number }) {
  return getDb().transaction(async (tx) => {
    const [invitation] = await tx.select().from(campusRecruitments).where(eq(campusRecruitments.id, input.recruitmentId)).limit(1).for("update");
    if (!invitation || (input.leadRepId && invitation.leadRepId !== input.leadRepId)) throw new TRPCError({ code: "NOT_FOUND", message: "Recruiting invitation not found" });
    if (!["invited", "accepted"].includes(invitation.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an open or accepted invitation can be revoked" });
    const revokedAt = new Date();
    await tx.update(campusRecruitments).set({ status: "revoked", revokedAt, revokedByUserId: input.actorUserId }).where(eq(campusRecruitments.id, invitation.id));
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "recruitment.revoked", entityType: "campus_recruitment", entityId: String(invitation.id), metadataJson: { previousStatus: invitation.status } });
    if (invitation.acceptedUserId) await notifyUser({ userId: invitation.acceptedUserId, type: "recruitment_revoked", title: "Recruiting invitation revoked", body: "The invitation was revoked before activation. Contact campus operations if you believe this is an error.", entityType: "campus_recruitment", entityId: invitation.id });
    return { recruitmentId: invitation.id, status: "revoked" as const, revokedAt };
  });
}

export async function activateRecruitment(recruitmentId: number, actorUserId: number) {
  const result = await getDb().transaction(async (tx) => {
    const [invitation] = await tx.select().from(campusRecruitments).where(eq(campusRecruitments.id, recruitmentId)).limit(1).for("update");
    if (!invitation || invitation.status !== "accepted" || !invitation.acceptedUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an accepted invitation can be activated" });
    const [user] = await tx.select().from(users).where(eq(users.id, invitation.acceptedUserId)).limit(1).for("update");
    const [rep] = await tx.select().from(reps).where(eq(reps.userId, invitation.acceptedUserId)).limit(1).for("update");
    if (!user || !rep || rep.campusId !== invitation.campusId || rep.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "The accepted rep profile is missing or no longer pending" });
    if (!rep.contractorAgreementSignedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Contractor terms must be accepted before activation" });
    const activatedAt = new Date();
    // Explicit sandbox identity adapter: no raw NIN/BVN is collected or persisted.
    await tx.update(users).set({ kycState: "verified", ninToken: `sandbox_identity_${randomBytes(12).toString("hex")}`, bankNameMatch: true }).where(eq(users.id, user.id));
    await tx.update(reps).set({ status: "active" }).where(eq(reps.id, rep.id));
    const [assignment] = await tx.select().from(campusLeadAssignments).where(eq(campusLeadAssignments.repId, rep.id)).limit(1).for("update");
    if (assignment) await tx.update(campusLeadAssignments).set({ leadRepId: invitation.leadRepId, campusId: invitation.campusId, assignedByUserId: actorUserId, assignedAt: activatedAt, revokedAt: null }).where(eq(campusLeadAssignments.id, assignment.id));
    else await tx.insert(campusLeadAssignments).values({ leadRepId: invitation.leadRepId, repId: rep.id, campusId: invitation.campusId, assignedByUserId: actorUserId, assignedAt: activatedAt });
    await tx.update(campusRecruitments).set({ status: "activated", activatedAt, activatedByUserId: actorUserId }).where(eq(campusRecruitments.id, invitation.id));
    await tx.insert(auditLogs).values({ actorUserId, action: "recruitment.activated_sandbox", entityType: "campus_recruitment", entityId: String(invitation.id), metadataJson: { repId: rep.id, campusId: invitation.campusId, identityAdapter: "sandbox", rawIdentityDocumentsStored: false } });
    return { repId: rep.id, userId: user.id, campusId: invitation.campusId, activatedAt };
  });
  await notifyUser({ userId: result.userId, type: "rep_activated", title: "Your rep workspace is active", body: "Sandbox identity activation and campus-team assignment are complete.", href: "/rep", entityType: "rep", entityId: result.repId });
  return { recruitmentId, repId: result.repId, status: "activated" as const, mode: "sandbox_identity" as const, activatedAt: result.activatedAt };
}

export async function expireRecruitments() {
  const expired = await getDb().update(campusRecruitments).set({ status: "expired" })
    .where(and(eq(campusRecruitments.status, "invited"), lte(campusRecruitments.expiresAt, new Date()), isNull(campusRecruitments.acceptedAt)))
    .returning({ id: campusRecruitments.id });
  return { expired: expired.length };
}
