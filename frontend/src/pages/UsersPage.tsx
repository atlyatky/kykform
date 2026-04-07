import { FormEvent, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api } from "../api";
import { AdminHeaderActions } from "../components/AdminHeaderActions";

type AdminUser = { id: string; email: string; createdAt: string; role: "ADMIN" | "USER"; totpEnabled: boolean };

export default function UsersPage() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [qrFor, setQrFor] = useState<{ email: string; qrDataUrl: string; otpauthUrl: string } | null>(null);

  async function load() {
    setRows(await api<AdminUser[]>("/api/admin/users"));
  }
  useEffect(() => { void load(); }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ email, password, role }) });
      setEmail(""); setPassword("");
      setMsg("Kullanici eklendi.");
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  async function onChangePassword(id: string, userEmail: string) {
    const p = window.prompt(`${userEmail} için yeni şifre (min 6):`);
    if (!p) return;
    if (p.trim().length < 6) return setErr("Şifre en az 6 karakter olmalı");
    setErr(""); setMsg("");
    try {
      await api(`/api/admin/users/${id}/password`, { method: "PUT", body: JSON.stringify({ password: p.trim() }) });
      setMsg("Şifre güncellendi.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  async function onSetup2fa(id: string, userEmail: string) {
    setErr(""); setMsg("");
    try {
      const r = await api<{ qrDataUrl: string; otpauthUrl: string }>(`/api/admin/users/${id}/2fa/setup`, { method: "POST" });
      setQrFor({ email: userEmail, qrDataUrl: r.qrDataUrl, otpauthUrl: r.otpauthUrl });
      setMsg("2FA kurulumu başlatıldı. QR kodu okutun ve kodu onaylayın.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  async function onEnable2fa(id: string) {
    const code = window.prompt("Authenticator kodu:");
    if (!code) return;
    setErr(""); setMsg("");
    try {
      await api(`/api/admin/users/${id}/2fa/enable`, { method: "POST", body: JSON.stringify({ otp: code }) });
      setMsg("2FA aktif edildi.");
      setQrFor(null);
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  async function onDisable2fa(id: string, userEmail: string) {
    if (!window.confirm(`${userEmail} için 2FA kapatılsın mı?`)) return;
    setErr(""); setMsg("");
    try {
      await api(`/api/admin/users/${id}/2fa/disable`, { method: "POST" });
      setMsg("2FA kapatıldı.");
      setQrFor(null);
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  async function onDelete(id: string, userEmail: string) {
    if (!window.confirm(`${userEmail} kullanicisi silinsin mi?`)) return;
    setErr(""); setMsg("");
    try {
      await api(`/api/admin/users/${id}`, { method: "DELETE" });
      setMsg("Kullanici silindi.");
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Hata");
    }
  }

  return (
    <div className="layout">
      <div className="card" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Kullanicilar</h2>
        <AdminHeaderActions />
      </div>

      <form onSubmit={onCreate} className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Yeni kullanıcı ekle</h3>
        <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "1fr 1fr 160px auto" }}>
          <input className="input" type="email" placeholder="admin@firma.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Sifre (min 6)" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
            <option value="USER">Kullanıcı</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button className="btn btn-primary" type="submit">Ekle</button>
        </div>
        {msg && <div style={{ color: "var(--success)", marginTop: "0.5rem" }}>{msg}</div>}
        {err && <div style={{ color: "var(--danger)", marginTop: "0.5rem" }}>{err}</div>}
      </form>

      {qrFor && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700 }}>2FA Kurulum: {qrFor.email}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>QR okutun, sonra tabloda “Aktif et” deyin.</div>
            </div>
            <button className="btn" type="button" onClick={() => setQrFor(null)}>Kapat</button>
          </div>
          {qrFor.qrDataUrl ? (
            <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "180px 1fr", gap: "1rem", alignItems: "center" }}>
              <img src={qrFor.qrDataUrl} alt="2FA QR" style={{ width: 180, height: 180, borderRadius: 12, background: "#fff", padding: 8 }} />
              <div style={{ fontFamily: "monospace", fontSize: "0.85rem", wordBreak: "break-all", color: "var(--muted)" }}>
                {qrFor.otpauthUrl}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "0.75rem", color: "var(--muted)" }}>QR üretilemedi.</div>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface2)" }}>
              <th style={{ padding: "0.8rem", textAlign: "left" }}>E-posta</th>
              <th style={{ padding: "0.8rem", textAlign: "left" }}>Rol</th>
              <th style={{ padding: "0.8rem", textAlign: "left" }}>2FA</th>
              <th style={{ padding: "0.8rem", textAlign: "left" }}>Olusturulma</th>
              <th style={{ padding: "0.8rem", textAlign: "right" }}>Islem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "0.8rem" }}>{r.email}</td>
                <td style={{ padding: "0.8rem" }}>{r.role}</td>
                <td style={{ padding: "0.8rem" }}>{r.totpEnabled ? "Aktif" : "Kapalı"}</td>
                <td style={{ padding: "0.8rem" }}>{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                <td style={{ padding: "0.8rem", textAlign: "right" }}>
                  <button className="btn btn-icon" type="button" onClick={() => void onChangePassword(r.id, r.email)} title="Şifre değiştir">
                    <KeyRound size={16} />
                  </button>
                  {!r.totpEnabled ? (
                    <>
                      <button className="btn btn-icon" type="button" onClick={() => void onSetup2fa(r.id, r.email)} title="2FA kur">
                        <ShieldCheck size={16} />
                      </button>
                      <button className="btn btn-icon" type="button" onClick={() => void onEnable2fa(r.id)} title="2FA aktif et">
                        <ShieldCheck size={16} />
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-icon" type="button" onClick={() => void onDisable2fa(r.id, r.email)} title="2FA kapat">
                      <ShieldOff size={16} />
                    </button>
                  )}
                  <button className="btn btn-icon" type="button" onClick={() => void onDelete(r.id, r.email)} title="Sil">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} style={{ padding: "1rem" }}>Kullanici yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
