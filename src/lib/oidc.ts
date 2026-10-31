// Authorization Code + PKCE against the deployment's identity provider (the cluster's Keycloak). The verifier and
// state live in sessionStorage only for the round trip.
const KEY = "kf_oidc_pending";
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type OidcConfig = { issuer: string; clientId: string };
const redirectUri = () => `${window.location.origin}/auth/callback`;

export async function startSignIn(config: OidcConfig) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem(KEY, JSON.stringify({ verifier, state, ...config }));
  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", scope: "openid profile",
    redirect_uri: redirectUri(), code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  window.location.assign(url.toString());
}

// The callback: trade the code for the provider's access token. Throws with a message for the person signing in.
export async function finishSignIn(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const pending = JSON.parse(sessionStorage.getItem(KEY) || "null") as ({ verifier: string; state: string } & OidcConfig) | null;
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
  return body.access_token as string;
}
