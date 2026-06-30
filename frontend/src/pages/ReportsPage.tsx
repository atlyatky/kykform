import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Mail,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import { AdminHeaderActions } from "../components/AdminHeaderActions";
import { BrandLogo } from "../components/BrandLogo";

type EntityStatusRow = {
  entityId: string;
  label: string;
  submitted: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

type NonCompliantSubmission = {
  submissionId: string;
  createdAt: string;
  entityLabel: string | null;
  issues: Array<{
    questionId: string;
    questionTitle: string;
    answer: string;
    status: string;
  }>;
};

type FormDailyReport = {
  key: string;
  label: string;
  found: boolean;
  formId: string | null;
  formTitle: string | null;
  slug: string | null;
  entities: EntityStatusRow[];
  summary: {
    totalEntities: number;
    submittedCount: number;
    missingCount: number;
    nonCompliantCount: number;
    totalSubmissions: number;
  };
  nonCompliantSubmissions: NonCompliantSubmission[];
};

type DailyReportsPayload = {
  date: string;
  dateLabel: string;
  generatedAt: string;
  reports: FormDailyReport[];
  totals: {
    missingCount: number;
    submittedCount: number;
    nonCompliantCount: number;
  };
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTrTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export default function ReportsPage() {
  const [date, setDate] = useState(todayIso);
  const [data, setData] = useState<DailyReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await api<DailyReportsPayload>(`/api/reports/daily?date=${encodeURIComponent(date)}`);
      setData(res);
    } catch (ex) {
      setData(null);
      setErr(ex instanceof Error ? ex.message : "Rapor yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    const list = recipients
      .split(/[,;\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!list.length) {
      setErr("En az bir e-posta adresi girin.");
      return;
    }
    setSending(true);
    setErr("");
    setMsg("");
    try {
      await api("/api/reports/daily/email", {
        method: "POST",
        body: JSON.stringify({ date, recipients: list }),
      });
      setMsg("Rapor e-posta ile gönderildi.");
      setEmailOpen(false);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "E-posta gönderilemedi");
    } finally {
      setSending(false);
    }
  }

  const totals = data?.totals ?? { missingCount: 0, submittedCount: 0, nonCompliantCount: 0 };

  return (
    <div className="layout">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <BrandLogo height={36} />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.15rem" }}>Raporlar</h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
              Vinç, forklift ve transpalet günlük kontrol özeti
            </p>
          </div>
        </div>
        <AdminHeaderActions />
      </header>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
              <span style={{ color: "var(--muted)" }}>Rapor tarihi</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ padding: "0.4rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
              />
            </label>
            <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} />
              Yenile
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setEmailOpen((v) => !v)}>
              <Mail size={16} />
              E-posta gönder
            </button>
          </div>
          {data && (
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {data.dateLabel} · Son güncelleme: {new Date(data.generatedAt).toLocaleTimeString("tr-TR")}
            </span>
          )}
        </div>

        {emailOpen && (
          <form onSubmit={(e) => void sendEmail(e)} style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
              Alıcılar (virgül veya satır ile ayırın)
            </label>
            <textarea
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              rows={2}
              placeholder="ornek@sirket.com, yonetici@sirket.com"
              style={{ width: "100%", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)", marginBottom: "0.5rem" }}
            />
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending ? "Gönderiliyor…" : "Raporu gönder"}
            </button>
          </form>
        )}
      </section>

      {err && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--danger)", color: "var(--danger)" }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--success)", color: "var(--success)" }}>
          {msg}
        </div>
      )}

      <div className="stats-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="card reports-stat">
          <CheckCircle2 size={22} color="var(--success)" />
          <div>
            <div className="stat-value">{totals.submittedCount}</div>
            <div className="stat-label">Gönderildi</div>
          </div>
        </div>
        <div className="card reports-stat">
          <XCircle size={22} color="var(--danger)" />
          <div>
            <div className="stat-value">{totals.missingCount}</div>
            <div className="stat-label">Gönderilmedi</div>
          </div>
        </div>
        <div className="card reports-stat">
          <AlertTriangle size={22} color="#c47a00" />
          <div>
            <div className="stat-value">{totals.nonCompliantCount}</div>
            <div className="stat-label">Uygunsuz kayıt</div>
          </div>
        </div>
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Rapor yükleniyor…</p>}

      {!loading &&
        data?.reports.map((report) => (
          <section key={report.key} className="card" style={{ marginBottom: "1.25rem" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: "0.5rem",
                marginBottom: "1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <ClipboardList size={20} color="var(--primary)" />
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{report.label}</h2>
                  {report.found && report.formTitle && (
                    <p style={{ margin: "0.15rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                      {report.formTitle}
                      {report.formId && (
                        <>
                          {" · "}
                          <Link to={`/forms/${report.formId}/dashboard`}>Detay</Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
              {report.found && (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span className="badge badge-ok">{report.summary.submittedCount} gönderildi</span>
                  <span className="badge badge-bad">{report.summary.missingCount} eksik</span>
                  {report.summary.nonCompliantCount > 0 && (
                    <span className="badge badge-warn">{report.summary.nonCompliantCount} uygunsuz</span>
                  )}
                </div>
              )}
            </div>

            {!report.found && (
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Bu kategori için form bulunamadı. Form başlığında ilgili kelime geçmeli (ör. vinç, forklift,
                transpalet).
              </p>
            )}

            {report.found && (
              <>
                <h3 style={{ fontSize: "0.92rem", margin: "0 0 0.5rem" }}>Gönderim durumu</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Varlık / Kayıt</th>
                        <th>Durum</th>
                        <th>Kayıt sayısı</th>
                        <th>Son gönderim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.entities.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ color: "var(--muted)" }}>
                            Bu tarihte kayıt yok.
                          </td>
                        </tr>
                      ) : (
                        report.entities.map((e) => (
                          <tr key={e.entityId}>
                            <td>{e.label}</td>
                            <td>
                              {e.submitted ? (
                                <span className="status-ok">Gönderildi</span>
                              ) : (
                                <span className="status-bad">Gönderilmedi</span>
                              )}
                            </td>
                            <td>{e.submissionCount}</td>
                            <td>{formatTrTime(e.lastSubmittedAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {report.nonCompliantSubmissions.length > 0 && (
                  <>
                    <h3 style={{ fontSize: "0.92rem", margin: "1.25rem 0 0.5rem" }}>Uygunsuz cevaplar</h3>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Saat</th>
                            <th>Varlık</th>
                            <th>Soru</th>
                            <th>Cevap</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.nonCompliantSubmissions.flatMap((s) =>
                            s.issues.map((issue, idx) => (
                              <tr key={`${s.submissionId}-${issue.questionId}-${idx}`}>
                                <td>{idx === 0 ? formatTrTime(s.createdAt) : ""}</td>
                                <td>{idx === 0 ? s.entityLabel ?? "—" : ""}</td>
                                <td>{issue.questionTitle}</td>
                                <td>
                                  <span className="status-bad">{issue.answer}</span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {report.summary.totalSubmissions > 0 && report.nonCompliantSubmissions.length === 0 && (
                  <p style={{ margin: "1rem 0 0", color: "var(--success)", fontSize: "0.9rem" }}>
                    Bu tarihte uygunsuz cevap tespit edilmedi.
                  </p>
                )}
              </>
            )}
          </section>
        ))}
    </div>
  );
}
