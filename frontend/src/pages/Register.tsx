import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api";

export default function Register() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [canRegister, setCanRegister] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ canRegister: boolean }>("/api/auth/status", { auth: false })
      .then((s) => setCanRegister(s.canRegister))
      .catch(() => setCanRegister(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const r = await api<{ token: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        auth: false,
      });
      setToken(r.token);
      nav("/");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  if (canRegister === false) {
    return (
      <div className="layout" style={{ maxWidth: 420 }}>
        <div className="card">
          <h1>Kayıt kapalı</h1>
          <p style={{ color: "var(--muted)" }}>Zaten bir yönetici hesabı tanımlı. Lütfen giriş yapın.</p>
          <Link to="/login" className="btn btn-primary" style={{ display: "inline-block", marginTop: "1rem" }}>
            Giriş
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="layout" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>İlk yönetici</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Veritabanında admin yoksa bir kez açılır.</p>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label>E-posta</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label>Şifre (min 6)</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          {err && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem" }} role="alert">
              {err}
            </p>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "0.5rem" }}>
            Kayıt ol
          </button>
        </form>
        <p style={{ marginTop: "1.25rem", fontSize: "0.9rem" }}>
          <Link to="/login">Girişe dön</Link>
        </p>
      </div>
    </div>
  );
}
