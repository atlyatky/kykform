import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, Pencil, QrCode, Rocket, Trash2, BarChart3, Plus } from "lucide-react";
import { api, apiBaseUrl } from "../api";
import { BrandLogo } from "../components/BrandLogo";

type Row = {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  revision: number;
  periodUnit: "NONE" | "DAY" | "MONTH" | "YEAR";
  periodValue: number;
  expectedSubmissions: number;
  invalidAlertEnabled: boolean;
  submissionCount: number;
};

const periodLabel = (u: Row["periodUnit"], v: number, c: number) => {
  if (u === "NONE") return "Yok";
  const unitStr = u === "DAY" ? "gün" : u === "MONTH" ? "ay" : "yıl";
  return `Her ${v} ${unitStr} (${c} adet)`;
};

export default function FormList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [qrForm, setQrForm] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api<Row[]>("/api/forms"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => setRows([]));
  }, []);

  async function createForm(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await api<{ id: string }>("/api/forms", { method: "POST", body: JSON.stringify({ title: title.trim() }) });
    setTitle("");
    nav(`/forms/${r.id}/edit`);
  }

  async function togglePublish(row: Row) {
    await api(`/api/forms/${row.id}`, { method: "PATCH", body: JSON.stringify({ published: !row.published }) });
    await load();
  }

  async function removeForm(row: Row) {
    if (!window.confirm(`Form silinsin mi?\n${row.title}`)) return;
    await api(`/api/forms/${row.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="layout">
      <header className="topbar">
        <BrandLogo />
        <div className="badge">Form Merkezi</div>
      </header>

      <form onSubmit={createForm} className="card" style={{ marginBottom: "1rem", display: "flex", gap: "0.6rem" }}>
        <input className="input" value={title} placeholder="Yeni form başlığı (Örn: Saha Denetimi)" onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-primary" type="submit"><Plus size={16} /> Form Oluştur</button>
      </form>

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-title">Toplam Form</div><div className="stat-value">{rows.length}</div></div>
        <div className="stat-card"><div className="stat-title">Yayında</div><div className="stat-value">{rows.filter((x) => x.published).length}</div></div>
        <div className="stat-card"><div className="stat-title">Toplam Yanıt</div><div className="stat-value">{rows.reduce((a, b) => a + b.submissionCount, 0)}</div></div>
      </section>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
              <th style={{ padding: "0.8rem", width: "120px", fontSize: "0.85rem" }}>Form No</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem" }}>Başlık</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem" }}>Durum</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem" }}>Revizyon</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem" }}>Periyot</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem" }}>Uygunsuz</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem" }}>Yanıt</th>
              <th style={{ padding: "0.8rem", fontSize: "0.85rem", textAlign: "right" }}>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={{ padding: "1rem" }} colSpan={8}>Yükleniyor...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td style={{ padding: "1rem" }} colSpan={8}>Form bulunamadı.</td></tr>
            ) : (
              rows.map((f) => {
                const formNo = `FRM-${f.id.slice(-6).toUpperCase()}`;
                return (
                  <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.8rem", fontFamily: "monospace", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem" }}>{formNo}</td>
                    <td style={{ padding: "0.8rem", fontSize: "0.85rem" }}>
                      <div style={{ fontWeight: 600 }}>{f.title}</div>
                    </td>
                    <td style={{ padding: "0.8rem" }}><span className={f.published ? "badge badge-live" : "badge"}>{f.published ? "Yayında" : "Taslak"}</span></td>
                    <td style={{ padding: "0.8rem", fontSize: "0.85rem" }}>r{f.revision}</td>
                    <td style={{ padding: "0.8rem", fontSize: "0.85rem" }}>{periodLabel(f.periodUnit, f.periodValue, f.expectedSubmissions)}</td>
                    <td style={{ padding: "0.8rem", fontSize: "0.85rem" }}>{f.invalidAlertEnabled ? "Aktif" : "Pasif"}</td>
                    <td style={{ padding: "0.8rem", fontSize: "0.85rem" }}>{f.submissionCount}</td>
                    <td style={{ padding: "0.8rem" }}>
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button className="btn btn-icon" type="button" title="QR Kodu" onClick={() => setQrForm(f)}><QrCode size={16} /></button>
                        <Link className="btn btn-icon" to={`/forms/${f.id}/edit`} title="Düzenle"><Pencil size={16} /></Link>
                        <Link className="btn btn-icon" to={`/forms/${f.id}/dashboard`} title="Analiz"><BarChart3 size={16} /></Link>
                        <button className="btn btn-icon" type="button" title={f.published ? "Yayından Kaldır" : "Yayınla"} onClick={() => void togglePublish(f)}>
                          <Rocket size={16} color={f.published ? "var(--success)" : "var(--muted)"} />
                        </button>
                        <button className="btn btn-icon" type="button" title="Sil" style={{ color: "var(--danger)" }} onClick={() => void removeForm(f)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {qrForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(6,24,48,.5)", display: "grid", placeItems: "center", zIndex: 20 }} onClick={() => setQrForm(null)}>
          <div className="card" style={{ width: 350 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{qrForm.title}</h3>
            <div className="badge" style={{ marginBottom: 8 }}>Form No: FRM-{qrForm.id.slice(-6).toUpperCase()}</div>
            <img src={`${apiBaseUrl}/api/forms/${qrForm.id}/qr?format=png`} alt="qr" style={{ width: 290, height: 290, display: "block", margin: "0 auto", background: "#fff", padding: 8 }} />
            <button className="btn" style={{ width: "100%", marginTop: "0.8rem" }} type="button" onClick={() => setQrForm(null)}><Eye size={15} /> Kapat</button>
          </div>
        </div>
      )}
    </div>
  );
}
