import "dotenv/config";
import { eq } from "drizzle-orm";
import { reps, users } from "../db/schema";
import { getDb } from "../api/queries/connection";

async function main() {
  const db = getDb();
  const [campus] = await db.select({ campusId: reps.campusId }).from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  if (!campus) throw new Error("Seeded campus is required");
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const phoneE164 = `+23496${String(Date.now()).slice(-8)}`;
  const [user] = await db.insert(users).values({ phoneE164, name: `Browser Campus Lead ${suffix.slice(0, 6)}`, role: "rep", kycState: "verified" }).returning();
  await db.insert(reps).values({ userId: user.id, campusId: campus.campusId, code: `KF-P12B-${suffix.slice(0, 9)}`.toUpperCase(), tier: "campus_lead", status: "active", contractorAgreementSignedAt: new Date() });
  console.log(JSON.stringify({ phoneE164, name: user.name }));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
