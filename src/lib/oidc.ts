// Authorization Code + PKCE against the deployment's identity provider (the cluster's Keycloak). The verifier and
// state live in sessionStorage only for the round trip.
const KEY = "kf_oidc_pending";
// What signing out at the provider needs; kept beside the session it belongs to.
const PROVIDER_SESSION_KEY = "kf_oidc_session";
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type OidcConfig = { issuer: string; clientId: string };
const redirectUri = () => `${window.location.origin}/auth/callback`;

// returnTo: an in-app path to come back to after signing in (a recruiting invitation, say).
export async function startSignIn(config: OidcConfig, returnTo?: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem(KEY, JSON.stringify({ verifier, state, returnTo, ...config }));
  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", scope: "openid profile email",
    redirect_uri: redirectUri(), code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  window.location.assign(url.toString());
}

// The callback: trade the code for the provider's access token. Throws with a message for the person signing in.
export async function finishSignIn(search: string): Promise<{ accessToken: string; returnTo?: string }> {
  const params = new URLSearchParams(search);
  const pending = JSON.parse(sessionStorage.getItem(KEY) || "null") as ({ verifier: string; state: string; returnTo?: string } & OidcConfig) | null;
  sessionStorage.removeItem(KEY);
  if (params.get("error")) throw new Error(params.get("error_description") || "Sign-in was cancelled.");
  if (!pending || !params.get("code") || params.get("state") !== pending.state) throw new Error("This sign-in link has expired. Sign in again.");
  const res = await fetch(`${pending.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: pending.clientId, code: params.get("code")!,
      redirect_uri: redirectUri(), code_verifier: pending.verifier }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error("Sign-in could not be completed. Sign in again.");
  localStorage.setItem(PROVIDER_SESSION_KEY, JSON.stringify({ issuer: pending.issuer, clientId: pending.clientId, idToken: body.id_token }));
  const returnTo = pending.returnTo?.startsWith("/") && !pending.returnTo.startsWith("//") ? pending.returnTo : undefined;
  return { accessToken: body.access_token as string, returnTo };
}

// Sign out at the provider too, or the next "Sign in" would pass straight through on its session. Leaves the page
// when there is a provider session to end; false means there was none and the caller stays in charge.
export function endProviderSession(returnTo = "/"): boolean {
  const stored = JSON.parse(localStorage.getItem(PROVIDER_SESSION_KEY) || "null") as ({ idToken?: string } & OidcConfig) | null;
  localStorage.removeItem(PROVIDER_SESSION_KEY);
  if (!stored) return false;
  const url = new URL(`${stored.issuer}/protocol/openid-connect/logout`);
  url.search = new URLSearchParams({ client_id: stored.clientId, post_logout_redirect_uri: `${window.location.origin}${returnTo}`,
    ...(stored.idToken ? { id_token_hint: stored.idToken } : {}) }).toString();
  window.location.assign(url.toString());
  return true;
}
