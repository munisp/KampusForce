import { TRPCError } from "@trpc/server";
import type { User } from "@db/schema";

// Creates sign-in accounts at the identity provider for self-registration. A service-account client with only
// manage-users and view-realm; KF_KEYCLOAK_INTERNAL_URL reaches Keycloak inside the cluster.
const issuer = process.env.KF_OIDC_ISSUER || "";
const clientId = process.env.KF_KEYCLOAK_ADMIN_CLIENT_ID || "";
const clientSecret = process.env.KF_KEYCLOAK_ADMIN_CLIENT_SECRET || "";

export function keycloakAdminConfigured() {
  return Boolean(issuer && clientId && clientSecret);
}

function endpoints() {
  const url = new URL(issuer);
  const realm = url.pathname.split("/").filter(Boolean).pop() || "";
  const base = (process.env.KF_KEYCLOAK_INTERNAL_URL || url.origin).replace(/\/$/, "");
  return { token: `${base}/realms/${realm}/protocol/openid-connect/token`, admin: `${base}/admin/realms/${realm}` };
}

async function adminHeaders() {
  const res = await fetch(endpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Identity provider refused the registration client (${res.status})`);
  const body = (await res.json()) as { access_token: string };
  return { Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json" };
}

export type NewAccount = { email: string; firstName: string; lastName: string; role: User["role"]; returnTo: string };

// Keycloak emails the owner a link to verify the address and choose a password, so no password passes through this
// app and nobody holds one before the owner does. Returns null when the email already has an account: that account's
// link is sent again if it was never verified, and the caller answers the same either way.
export async function createSignInAccount(account: NewAccount): Promise<string | null> {
  const { admin } = endpoints();
  const headers = await adminHeaders();
  const created = await fetch(`${admin}/users`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      username: account.email, email: account.email, firstName: account.firstName, lastName: account.lastName, enabled: true,
      emailVerified: false, requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD"],
    }),
  });
  if (created.status === 409) {
    const found = await fetch(`${admin}/users?email=${encodeURIComponent(account.email)}&exact=true`, { headers, signal: AbortSignal.timeout(15_000) });
    const [existing] = (found.ok ? await found.json() : []) as { id: string; emailVerified?: boolean }[];
    if (existing && !existing.emailVerified) await sendAccountEmail(existing.id, account.returnTo);
    return null;
  }
  if (created.status === 400) {
    const detail = (await created.json().catch(() => ({}))) as { error_description?: string; errorMessage?: string };
    throw new TRPCError({ code: "BAD_REQUEST", message: detail.error_description || detail.errorMessage || "The email address was not accepted." });
  }
  if (!created.ok) throw new Error(`Identity provider could not create the account (${created.status})`);
  const id = created.headers.get("location")?.split("/").pop() || "";
  try {
    const role = await fetch(`${admin}/roles/${account.role}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!role.ok) throw new Error(`Identity provider has no ${account.role} role (${role.status})`);
    const mapped = await fetch(`${admin}/users/${id}/role-mappings/realm`, { method: "POST", headers, body: JSON.stringify([await role.json()]), signal: AbortSignal.timeout(15_000) });
    if (!mapped.ok) throw new Error(`Identity provider could not assign the role (${mapped.status})`);
  } catch (error) {
    await deleteSignInAccount(id).catch(() => undefined);
    throw error;
  }
  return id;
}

export async function sendAccountEmail(id: string, returnTo: string) {
  const query = new URLSearchParams({ client_id: process.env.KF_OIDC_CLIENT_ID || "", redirect_uri: returnTo, lifespan: String(24 * 3600) });
  const sent = await fetch(`${endpoints().admin}/users/${id}/execute-actions-email?${query}`, {
    method: "PUT", headers: await adminHeaders(), body: JSON.stringify(["VERIFY_EMAIL", "UPDATE_PASSWORD"]), signal: AbortSignal.timeout(30_000),
  });
  if (!sent.ok) throw new Error(`Identity provider could not send the email (${sent.status})`);
}

export async function deleteSignInAccount(id: string) {
  await fetch(`${endpoints().admin}/users/${id}`, { method: "DELETE", headers: await adminHeaders(), signal: AbortSignal.timeout(15_000) });
}
