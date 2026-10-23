import { useAuth } from "@/hooks/use-auth";
import { useConvex } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { HubdexWordmark } from "@/components/hubdex";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback: string,
): string {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "signIn" | "register";
type LoadingAction = "password" | "google" | "guest" | null;

function GoogleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width="18"
      height="18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function GoogleSignInButton({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-3 border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {loading ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Connecting to Google…
        </>
      ) : (
        <>
          <GoogleIcon />
          <span>Sign in with Google</span>
        </>
      )}
    </button>
  );
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn, signOut } = useAuth();
  const convex = useConvex();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth ?? "/dashboard",
  );

  const [mode, setMode] = useState<Mode>("signIn");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const isRegisteringRef = useRef(false);

  const isLoading = loadingAction !== null;

  useEffect(() => {
    if (!authLoading && isAuthenticated && !isRegisteringRef.current) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    if (!name || !email || !password || !confirm) {
      setError("All fields are required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address, like name@example.com.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoadingAction("password");
    isRegisteringRef.current = true;
    try {
      const emailTaken = await convex.query(
        api.authAccounts.passwordAccountExists,
        { email },
      );
      if (emailTaken) {
        setError(
          "An account with this email already exists. Please sign in instead.",
        );
        return;
      }

      await signIn("password", { flow: "signUp", email, password, name });
      await signOut();
      setRegisteredEmail(email);
      setMode("signIn");
      setNotice("Your account has been created. Please sign in.");
    } catch (err) {
      console.error("Registration error:", err);
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (
        message.includes("already exists") ||
        message.includes("unique") ||
        message.includes("duplicate")
      ) {
        setError(
          "An account with this email already exists. Please sign in instead.",
        );
      } else if (message.includes("password")) {
        setError("Password must be at least 8 characters long.");
      } else {
        setError("Registration failed. Please try again.");
      }
    } finally {
      isRegisteringRef.current = false;
      setLoadingAction(null);
    }
  };

  const handlePasswordSignIn = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address, like name@example.com.");
      return;
    }

    setLoadingAction("password");
    try {
      await signIn("password", { flow: "signIn", email, password });
      navigate(redirect);
    } catch (err) {
      console.error("Sign-in error:", err);
      setError("Invalid email or password.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setLoadingAction("google");
    try {
      await signIn("google", { redirectTo: redirect });
      navigate(redirect);
    } catch (err) {
      console.error("Google sign-in error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Google sign-in failed. Please try again.";
      if (message !== "Google sign-in was canceled.") {
        setError(message);
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGuestLogin = async () => {
    setError(null);
    setNotice(null);
    setLoadingAction("guest");
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (err) {
      console.error("Guest login error:", err);
      setError(
        "Failed to sign in as guest: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="ibm-grid flex min-h-screen flex-col bg-background text-foreground">
      {/* Minimal top bar */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Hubdex home">
            <HubdexWordmark />
          </Link>
          <span className="ibm-eyebrow text-muted-foreground">
            Application tracking
          </span>
        </div>
        <div className="h-0.5 w-full bg-primary" />
      </header>

      {/* Auth content */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="border border-border bg-background shadow-[8px_8px_0_0_rgba(22,22,22,0.06)]">
            <div className="h-1 w-full bg-primary" />
            <div className="px-6 py-8 sm:px-8">
              {/* Mode tabs */}
              <div
                className="grid grid-cols-2 border border-border"
                role="tablist"
                aria-label="Authentication mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signIn"}
                  onClick={() => switchMode("signIn")}
                  className={
                    "h-10 text-sm font-medium transition-colors " +
                    (mode === "signIn"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  onClick={() => switchMode("register")}
                  className={
                    "h-10 text-sm font-medium transition-colors " +
                    (mode === "register"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  Register
                </button>
              </div>

              {mode === "signIn" ? (
                <>
                  <p className="ibm-eyebrow mt-8 text-[#0f62fe]">Welcome back</p>
                  <h1 className="mt-2 text-2xl font-bold tracking-[-0.01em]">
                    Open your hub
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sign in with Google or your email and password to pick up
                    your search where you left it.
                  </p>

                  {notice && (
                    <p
                      role="status"
                      className="mt-4 border border-[#0f62fe] bg-[#edf5ff] px-3 py-2 text-sm text-[#0f62fe] dark:border-primary dark:bg-primary/10 dark:text-[#78a9ff]"
                    >
                      {notice}
                    </p>
                  )}

                  <div className="mt-6">
                    <GoogleSignInButton
                      onClick={handleGoogleSignIn}
                      disabled={isLoading}
                      loading={loadingAction === "google"}
                    />
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <span className="h-px flex-1 bg-border" />
                    <span className="ibm-eyebrow text-muted-foreground">
                      or with email
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <form
                    onSubmit={handlePasswordSignIn}
                    className="mt-6"
                    noValidate
                  >
                    <label
                      htmlFor="signin-email"
                      className="ibm-eyebrow text-muted-foreground"
                    >
                      Email address
                    </label>
                    <div className="relative mt-2">
                      <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        key={registeredEmail ?? "default-signin-email"}
                        id="signin-email"
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        autoComplete="email"
                        defaultValue={registeredEmail ?? undefined}
                        className="h-11 bg-background pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>

                    <label
                      htmlFor="signin-password"
                      className="ibm-eyebrow mt-4 block text-muted-foreground"
                    >
                      Password
                    </label>
                    <Input
                      id="signin-password"
                      name="password"
                      placeholder="Your password"
                      type="password"
                      autoComplete="current-password"
                      className="mt-2 h-11 bg-background"
                      disabled={isLoading}
                      required
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setError(
                          "Password reset is not available yet. You can also sign in with Google if your account uses the same email.",
                        )
                      }
                      className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Forgot password?
                    </button>

                    {error && (
                      <p role="alert" className="mt-3 text-sm text-destructive">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="mt-5 flex h-11 w-full items-center justify-center gap-2 bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-[#0353e8] disabled:opacity-50"
                    >
                      {loadingAction === "password" ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Signing in…
                        </>
                      ) : (
                        <>
                          Sign in
                          <ArrowRight className="size-4" />
                        </>
                      )}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="ibm-eyebrow mt-8 text-[#0f62fe]">Get started</p>
                  <h1 className="mt-2 text-2xl font-bold tracking-[-0.01em]">
                    Create your hub
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    One account, every application. Sign in with Google or
                    register with email below.
                  </p>

                  <div className="mt-6">
                    <GoogleSignInButton
                      onClick={handleGoogleSignIn}
                      disabled={isLoading}
                      loading={loadingAction === "google"}
                    />
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <span className="h-px flex-1 bg-border" />
                    <span className="ibm-eyebrow text-muted-foreground">
                      or register with email
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <form onSubmit={handleRegister} className="mt-6" noValidate>
                    <label
                      htmlFor="register-name"
                      className="ibm-eyebrow text-muted-foreground"
                    >
                      Full name
                    </label>
                    <Input
                      id="register-name"
                      name="name"
                      placeholder="Alex Doe"
                      type="text"
                      autoComplete="name"
                      maxLength={100}
                      className="mt-2 h-11 bg-background"
                      disabled={isLoading}
                      required
                    />

                    <label
                      htmlFor="register-email"
                      className="ibm-eyebrow mt-4 block text-muted-foreground"
                    >
                      Email address
                    </label>
                    <div className="relative mt-2">
                      <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="register-email"
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        autoComplete="email"
                        className="h-11 bg-background pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>

                    <label
                      htmlFor="register-password"
                      className="ibm-eyebrow mt-4 block text-muted-foreground"
                    >
                      Password
                    </label>
                    <Input
                      id="register-password"
                      name="password"
                      placeholder="At least 8 characters"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      className="mt-2 h-11 bg-background"
                      disabled={isLoading}
                      required
                    />

                    <label
                      htmlFor="register-confirm"
                      className="ibm-eyebrow mt-4 block text-muted-foreground"
                    >
                      Confirm password
                    </label>
                    <Input
                      id="register-confirm"
                      name="confirmPassword"
                      placeholder="Repeat your password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      className="mt-2 h-11 bg-background"
                      disabled={isLoading}
                      required
                    />

                    {error && (
                      <p role="alert" className="mt-3 text-sm text-destructive">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="mt-6 flex h-11 w-full items-center justify-center gap-2 bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-[#0353e8] disabled:opacity-50"
                    >
                      {loadingAction === "password" ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Creating account…
                        </>
                      ) : (
                        <>
                          Create account
                          <ArrowRight className="size-4" />
                        </>
                      )}
                    </button>
                  </form>
                </>
              )}

              <div className="mt-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="ibm-eyebrow text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={handleGuestLogin}
                disabled={isLoading}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 border border-[#161616] text-sm font-medium transition-colors hover:bg-[#161616] hover:text-white disabled:opacity-50 dark:border-foreground dark:hover:bg-foreground dark:hover:text-background"
              >
                {loadingAction === "guest" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Opening guest hub…
                  </>
                ) : (
                  "Continue as guest"
                )}
              </button>
            </div>

            <div className="border-t border-border bg-muted px-8 py-3 text-center text-xs text-muted-foreground">
              By continuing you agree to keep your job search honest.
            </div>
          </div>

          <p className="ibm-eyebrow mt-6 text-center text-muted-foreground">
            Hubdex: Every application. One hub.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
