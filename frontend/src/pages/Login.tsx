import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { BrandLogo } from "../components/BrandLogo";

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
    <div className="layout" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem" }}>
          <BrandLogo />
        </div>
      <div className="card">
        <h1>Giriş</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Yönetim paneli</p>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label>Kullanici</label>
            <input className="input" type="text" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
      </div>
      </div>
    </div>
  );
}
