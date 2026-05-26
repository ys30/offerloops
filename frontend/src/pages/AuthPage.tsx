import { useEffect, useRef, useState } from "react";
import { login, signup, googleAuth, fetchAuthProviders, forgotPassword, resetPassword } from "../api";
import type { User } from "../types";

interface Props {
  onAuth: (token: string, user: User) => void;
  onClose?: () => void;
  resetToken?: string | null;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: object) => void;
          renderButton: (el: HTMLElement, cfg: object) => void;
          prompt: () => void;
        };
      };
    };
    handleGoogleCredential?: (resp: { credential: string }) => void;
  }
}

export default function AuthModal({ onAuth, onClose, resetToken }: Props) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [googleClientId, setGoogleClientId] = useState<string | undefined>(
    import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  );
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAuthProviders().then(data => {
      setConfigured(data);
      if (data.google_client_id && !googleClientId) {
        setGoogleClientId(data.google_client_id);
      }
    }).catch(() => {});
  }, []);

  // Load Google GSI script and render button
  useEffect(() => {
    if (!googleClientId) return;

    window.handleGoogleCredential = async (resp) => {
      setError("");
      setLoading(true);
      try {
        const result = await googleAuth(resp.credential);
        localStorage.setItem("ol_token", result.token);
        onAuth(result.token, result.user);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Google sign-in failed");
      } finally {
        setLoading(false);
      }
    };

    const scriptId = "google-gsi";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => renderGoogleBtn();
      document.head.appendChild(script);
    } else {
      renderGoogleBtn();
    }

    function renderGoogleBtn() {
      if (!window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: window.handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        width: "100%",
        text: "signin_with",
      });
    }
  }, [googleClientId, onAuth]);

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setInfo(""); setLoading(true);
    try {
      const msg = await forgotPassword(email);
      setInfo(msg);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) { setError("Passwords don't match."); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      const result = await resetPassword(resetToken!, newPassword);
      localStorage.setItem("ol_token", result.token);
      onAuth(result.token, result.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  function handleOAuth(provider: string, path: string, envKey: string) {
    if (!configured[provider]) {
      setError(`${provider.charAt(0).toUpperCase() + provider.slice(1)} Sign-In is not configured. Add ${envKey} to your .env file.`);
      return;
    }
    window.location.href = path;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = mode === "login"
        ? await login(email, password)
        : await signup({ email, password, name, phone, location });
      localStorage.setItem("ol_token", result.token);
      onAuth(result.token, result.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: -0.5 }}>OfferLoops</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {mode === "login" ? "Sign in to your account" : "Create your account"}
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>

        {/* Social sign-in buttons — always shown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {googleClientId
            ? <div ref={googleBtnRef} style={{ width: "100%" }} />
            : <button onClick={() => handleOAuth("google", "/api/auth/google", "GOOGLE_CLIENT_ID")} style={{ ...socialBtn, background: "#fff", color: "#3c4043", border: "1px solid #dadce0" }}>
                <GoogleIcon /> Continue with Google
              </button>
          }
          <button onClick={() => handleOAuth("github", "/api/auth/github", "GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET")} style={{ ...socialBtn, background: "#24292e", color: "#fff" }}>
            <GitHubIcon /> Continue with GitHub
          </button>
          <button onClick={() => handleOAuth("linkedin", "/api/auth/linkedin", "LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET")} style={{ ...socialBtn, background: "#0077b5", color: "#fff" }}>
            <LinkedInIcon /> Continue with LinkedIn
          </button>
          <button onClick={() => handleOAuth("microsoft", "/api/auth/microsoft", "MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET")} style={{ ...socialBtn, background: "#fff", color: "#1a1a1a", border: "1px solid #e2e8f0" }}>
            <MicrosoftIcon /> Continue with Microsoft
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>or continue with email</span>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          </div>
        </div>

        {/* Forgot password form */}
        {mode === "forgot" && (
          <form onSubmit={handleForgot} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: "0 0 4px", fontSize: 13, color: "#64748b" }}>
              Enter your email and we'll send a reset link (or print it to the server console if SMTP isn't set up).
            </p>
            <input style={inp} type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            {error && <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "8px 12px", borderRadius: 6 }}>{error}</div>}
            {info && <div style={{ fontSize: 12, color: "#166534", background: "#f0fdf4", padding: "8px 12px", borderRadius: 6 }}>{info}</div>}
            <button type="submit" disabled={loading} style={submitBtn}>{loading ? "Sending…" : "Send reset link"}</button>
            <div style={{ textAlign: "center", fontSize: 12 }}>
              <button onClick={() => { setMode("login"); setError(""); setInfo(""); }} style={linkBtn}>← Back to sign in</button>
            </div>
          </form>
        )}

        {/* Reset password form */}
        {mode === "reset" && (
          <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: "0 0 4px", fontSize: 13, color: "#64748b" }}>Enter your new password.</p>
            <input style={inp} type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required autoComplete="new-password" />
            <input style={inp} type="password" placeholder="Confirm new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
            {error && <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "8px 12px", borderRadius: 6 }}>{error}</div>}
            <button type="submit" disabled={loading} style={submitBtn}>{loading ? "Saving…" : "Set new password"}</button>
          </form>
        )}

        {/* Email/password form */}
        {(mode === "login" || mode === "signup") && (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "signup" && (
            <input style={inp} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          )}
          <input style={inp} type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          <input style={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
          {mode === "signup" && (
            <>
              <input style={inp} placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
              <input style={inp} placeholder="Location, e.g. Los Alamos, NM (optional)" value={location} onChange={e => setLocation(e.target.value)} />
            </>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "8px 12px", borderRadius: 6 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={submitBtn}>
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          {mode === "login" && (
            <div style={{ textAlign: "right" }}>
              <button type="button" onClick={() => { setMode("forgot"); setError(""); setInfo(""); }} style={linkBtn}>
                Forgot password?
              </button>
            </div>
          )}
        </form>
        )}

        {(mode === "login" || mode === "signup") && (
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: "#64748b" }}>
          {mode === "login" ? (
            <>No account?{" "}<button onClick={() => { setMode("signup"); setError(""); }} style={linkBtn}>Sign up</button></>
          ) : (
            <>Have an account?{" "}<button onClick={() => { setMode("login"); setError(""); }} style={linkBtn}>Sign in</button></>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000,
  background: "rgba(15,23,42,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const card: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: "28px 28px",
  width: "100%", maxWidth: 400,
  boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
};

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #e2e8f0", borderRadius: 7,
  fontSize: 14, outline: "none", boxSizing: "border-box",
};

const submitBtn: React.CSSProperties = {
  width: "100%", padding: "10px",
  background: "#2563eb", color: "#fff",
  border: "none", borderRadius: 7,
  fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 2,
};

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "#2563eb",
  cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0,
};

const socialBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
  width: "100%", padding: "10px 16px",
  border: "1px solid transparent", borderRadius: 7,
  fontSize: 14, fontWeight: 600, cursor: "pointer",
  textDecoration: "none", boxSizing: "border-box",
};

function GoogleIcon() {
  return (
    <svg height="18" viewBox="0 0 24 24" width="18" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg height="18" viewBox="0 0 16 16" width="18" style={{ flexShrink: 0 }}>
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg height="18" viewBox="0 0 24 24" width="18" style={{ flexShrink: 0 }}>
      <path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg height="18" viewBox="0 0 21 21" width="18" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  );
}
