import { createRemoteJWKSet, jwtVerify } from "jose";
import { TRPCError } from "@trpc/server";
import type { User } from "@db/schema";

// Sign-in through an OpenID Connect provider (the cluster's Keycloak). The browser signs in there with
// Authorization Code + PKCE and hands the access token to the API, which checks it against the provider's keys
// and then opens an ordinary KampusForce session. Unset KF_OIDC_ISSUER leaves it off.
const issuer = process.env.KF_OIDC_ISSUER || "";
const clientId = process.env.KF_OIDC_CLIENT_ID || "";
const jwksUrl = process.env.KF_OIDC_JWKS_URL || (issuer ? `${issuer}/protocol/openid-connect/certs` : "");
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

// The provider's realm roles, most privileged first; a login gets the first one it holds.
const ROLES: User["role"][] = ["admin", "ops", "finance", "vendor", "rep"];

export function oidcConfig() {
  return issuer && clientId ? { issuer, clientId } : null;
}

export async function verifyProviderToken(token: string) {
  if (!jwks || !issuer || !clientId) throw new TRPCError({ code: "NOT_FOUND", message: "Single sign-on is not configured." });
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (payload.azp !== clientId) throw new Error("token was issued to another client");
    const realmRoles = ((payload.realm_access as { roles?: unknown } | undefined)?.roles ?? []) as unknown[];
    const role = ROLES.find((r) => realmRoles.includes(r));
    const phone = typeof payload.phone_number === "string" ? payload.phone_number : "";
    if (!role) throw new Error("no KampusForce role");
    if (!phone) throw new Error("no phone number");
    const name = typeof payload.name === "string" && payload.name ? payload.name : String(payload.preferred_username || "KampusForce user");
    return { role, phone, name };
  } catch (err) {
    const why = err instanceof Error ? err.message : "invalid token";
    throw new TRPCError({ code: "UNAUTHORIZED", message: why === "no KampusForce role" || why === "no phone number"
      ? `Your account has ${why === "no KampusForce role" ? "no KampusForce role" : "no phone number"} yet. Ask an administrator to add it.`
      : "Single sign-on failed. Sign in again." });
  }
}
