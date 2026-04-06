import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const r = await api<{ token: string }>("/api/auth/login", {
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

  return (
    <div className="layout" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Giriş</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Yönetim paneli</p>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label>E-posta</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label>Şifre</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem" }} role="alert">
              {err}
            </p>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "0.5rem" }}>
            Giriş yap
          </button>
        </form>
        <p style={{ marginTop: "1.25rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          İlk kurulum için <Link to="/register">kayıt</Link>
        </p>
      </div>
    </div>
  );
}
