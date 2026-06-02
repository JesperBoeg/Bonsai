import { createPasswordAccountAction, signInWithPasswordAction } from "../auth/actions";
import { getOptionalViewer } from "../../lib/auth";
import { redirect } from "next/navigation";

type SignInPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
    created?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const viewer = await getOptionalViewer();

  if (viewer) {
    redirect("/capture");
  }

  const params = await searchParams;
  const nextPath = params.next && params.next.startsWith("/") ? params.next : "/capture";

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">Authentication</p>
        <h1>Sign in or create an account.</h1>
        <p className="lede">Use your email address and password to continue.</p>
      </section>

      <section className="sign-in-grid">
        <article className="capture-card">
          <h2>Sign in</h2>
          <form action={signInWithPasswordAction} className="inline-form">
            <input name="next" type="hidden" value={nextPath} />
            <label className="field-block">
              <span>Email</span>
              <input autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
            </label>
            <label className="field-block">
              <span>Password</span>
              <input autoComplete="current-password" name="password" required type="password" />
            </label>
            <button className="button button-solid" type="submit">
              Sign in
            </button>
          </form>
          {params.error ? <p className="status-strip">{params.error}</p> : null}
        </article>

        <article className="capture-card">
          <h2>Create account</h2>
          <form action={createPasswordAccountAction} className="inline-form">
            <input name="next" type="hidden" value={nextPath} />
            <label className="field-block">
              <span>Email</span>
              <input autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
            </label>
            <label className="field-block">
              <span>Password</span>
              <input autoComplete="new-password" name="password" required type="password" />
            </label>
            <label className="field-block">
              <span>Confirm password</span>
              <input autoComplete="new-password" name="confirmPassword" required type="password" />
            </label>
            <button className="button button-solid" type="submit">
              Create account
            </button>
          </form>
          {params.created === "1" ? <p className="status-strip">Account created. You can sign in now.</p> : null}
        </article>
      </section>
    </div>
  );
}
