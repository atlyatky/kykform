import { FormEvent, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../api";
import { AdminHeaderActions } from "../components/AdminHeaderActions";

type AdminUser = { id: string; email: string; createdAt: string };

export default function UsersPage() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setRows(await api<AdminUser[]>("/api/admin/users"));
  }
  useEffect(() => { void load(); }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ email, password }) });
      setEmail(""); setPassword("");
      setMsg("Kullanici eklendi.");
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
        <h3 style={{ marginTop: 0 }}>Yeni admin ekle</h3>
        <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "1fr 1fr auto" }}>
          <input className="input" type="email" placeholder="admin@firma.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Sifre (min 6)" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn btn-primary" type="submit">Ekle</button>
        </div>
        {msg && <div style={{ color: "var(--success)", marginTop: "0.5rem" }}>{msg}</div>}
        {err && <div style={{ color: "var(--danger)", marginTop: "0.5rem" }}>{err}</div>}
      </form>

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface2)" }}>
              <th style={{ padding: "0.8rem", textAlign: "left" }}>E-posta</th>
              <th style={{ padding: "0.8rem", textAlign: "left" }}>Olusturulma</th>
              <th style={{ padding: "0.8rem", textAlign: "right" }}>Islem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "0.8rem" }}>{r.email}</td>
                <td style={{ padding: "0.8rem" }}>{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                <td style={{ padding: "0.8rem", textAlign: "right" }}>
                  <button className="btn btn-icon" type="button" onClick={() => void onDelete(r.id, r.email)} title="Sil">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} style={{ padding: "1rem" }}>Kullanici yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
