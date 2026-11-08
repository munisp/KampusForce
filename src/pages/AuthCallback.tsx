import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Brand } from "@/components/product/Brand";
import { finishSignIn } from "@/lib/oidc";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

import { workspacePath } from "@/lib/roles";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setSession } = useWorkspace();
  const [error, setError] = useState("");
  const started = useRef(false);
  const returnTo = useRef<string | undefined>(undefined);
  const login = trpc.auth.oidcLogin.useMutation({
    onSuccess: (data) => { setSession({ token: data.token, user: data.user }); navigate(returnTo.current || workspacePath(data.user.role), { replace: true }); },
    onError: (e) => setError(e.message),
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    finishSignIn(window.location.search).then((done) => { returnTo.current = done.returnTo; login.mutate({ accessToken: done.accessToken }); }).catch((e: Error) => setError(e.message));
  }, [login]);
  return <div className="entry-page"><header className="entry-nav"><Brand /></header>
    <main className="sandbox-section">{error
      ? <><p className="form-error" role="alert">{error}</p><a className="button primary" href="/">Back to sign-in</a></>
      : <p>Signing you in…</p>}</main></div>;
}
