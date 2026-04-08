import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { api } from "../api";

type DashboardData = {
  formId: string;
  title: string;
  totalSubmissions: number;
  submissionsLimit?: number;
  submissions?: Array<{
    submissionId: string;
    createdAt: string;
    answerList: Array<{
      questionId: string;
      questionTitle: string;
      questionType?: string;
      rawAnswer?: unknown;
      answer: string;
    }>;
  }>;
  choiceAggregates: Record<string, { questionTitle: string; counts: { label: string; count: number }[] }>;
};

export default function FormDashboard() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api<DashboardData>(`/api/forms/${id}/stats?limit=200`);
        if (!cancel) setData(res);
      } catch (err) { console.error(err); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [id]);

  const safeData: DashboardData = data ?? {
    formId: "",
    title: "",
    totalSubmissions: 0,
    submissions: [],
    choiceAggregates: {},
  };
  const submissions = Array.isArray(safeData.submissions) ? safeData.submissions : [];
  const safeFormId = typeof safeData.formId === "string" ? safeData.formId : "";
  const formNo = safeFormId ? `FRM-${safeFormId.slice(-6).toUpperCase()}` : "FRM-XXXXXX";
  const columns = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of submissions) {
      const answers = Array.isArray(s.answerList) ? s.answerList : [];
      for (const a of answers) {
        if (!m.has(a.questionId)) m.set(a.questionId, a.questionTitle);
      }
    }
    return [...m.entries()].map(([id, title]) => ({ id, title }));
  }, [submissions]);

  const rows = useMemo(() => {
    return submissions.map((s) => {
      const answers: Record<string, string> = {};
      const answerList = Array.isArray(s.answerList) ? s.answerList : [];
      for (const a of answerList) answers[a.questionId] = a.answer;
      const rawCreatedAt = typeof s.createdAt === "string" ? s.createdAt : "";
      const dt = new Date(rawCreatedAt);
      const validDate = !Number.isNaN(dt.getTime());
      const dateText = validDate ? dt.toLocaleDateString("tr-TR") : "-";
      const timeText = validDate ? dt.toLocaleTimeString("tr-TR") : "-";
      const dateKey = validDate ? rawCreatedAt.slice(0, 10) : "";
      return {
        submissionId: typeof s.submissionId === "string" ? s.submissionId : "",
        createdAt: rawCreatedAt,
        dateText,
        timeText,
        dateKey,
        answers,
        answerList,
      };
    });
  }, [submissions]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return rows.filter((r) => {
      if (fromDate && r.dateKey < fromDate) return false;
      if (toDate && r.dateKey > toDate) return false;
      if (!q) return true;
      const hay = [r.submissionId, r.dateText, r.timeText, ...Object.values(r.answers)].join(" ").toLocaleLowerCase("tr");
      return hay.includes(q);
    });
  }, [rows, search, fromDate, toDate]);

  const selectedRow = useMemo(
    () => filteredRows.find((r) => r.submissionId === selectedSubmissionId) ?? null,
    [filteredRows, selectedSubmissionId]
  );

  function getImageSrc(answerItem: { questionType?: string; rawAnswer?: unknown; answer: string }): string | null {
    const fromRaw = answerItem.rawAnswer;
    if (typeof fromRaw === "string") {
      if (fromRaw.startsWith("data:image/")) return fromRaw;
      if (/^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(fromRaw)) return fromRaw;
    }
    if (fromRaw && typeof fromRaw === "object") {
      const obj = fromRaw as Record<string, unknown>;
      const maybeUrl = typeof obj.url === "string" ? obj.url : typeof obj.src === "string" ? obj.src : "";
      if (maybeUrl.startsWith("data:image/")) return maybeUrl;
      if (/^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(maybeUrl)) return maybeUrl;
    }
    if (typeof answerItem.answer === "string") {
      const a = answerItem.answer.trim();
      if (a.startsWith("data:image/")) return a;
      if (/^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(a)) return a;
    }
    return null;
  }

  if (loading) return <div className="layout">Yükleniyor...</div>;
  if (!data) return <div className="layout">Veri bulunamadı.</div>;

  return (
    <div className="layout">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <BrandLogo />
          <div>
            <Link to="/" style={{ fontSize: "0.86rem", color: "var(--muted)" }}>← Listeye Dön</Link>
            <h1 style={{ margin: "0.35rem 0 0" }}>{safeData.title} - Analiz</h1>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Form No: {formNo}</div>
          </div>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-title">Toplam Yanıt Sayısı</div>
          <div className="stat-value">{safeData.totalSubmissions}</div>
        </div>
        <div className="stat-card">
          <div className="stat-title">Filtre Sonucu</div>
          <div className="stat-value">{filteredRows.length}</div>
        </div>
      </section>
      {typeof safeData.submissionsLimit === "number" && safeData.totalSubmissions > safeData.submissionsLimit && (
        <div className="card" style={{ padding: "0.75rem 1rem", color: "var(--muted)" }}>
          Performans için son {safeData.submissionsLimit} kayıt gösteriliyor (toplam {safeData.totalSubmissions}).
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Form Girişleri (Kart)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0.6rem", marginBottom: "0.9rem" }}>
          <input
            className="input"
            placeholder="Ara (yanıt, saat, id...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        {submissions.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Henüz form girişi yok.</div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.8rem" }}>
              {filteredRows.map((r) => {
                const firstImage = r.answerList.map((a) => getImageSrc(a)).find(Boolean) ?? null;
                return (
                  <button
                    key={r.submissionId}
                    type="button"
                    className="btn"
                    onClick={() => setSelectedSubmissionId(r.submissionId)}
                    style={{
                      textAlign: "left",
                      display: "block",
                      width: "100%",
                      padding: "0.8rem",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>Kayıt #{r.submissionId.slice(0, 8)}</div>
                    <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: "0.55rem" }}>{r.dateText} {r.timeText}</div>
                    {firstImage ? (
                      <img
                        src={firstImage}
                        alt="Yuklenen gorsel"
                        style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", marginBottom: "0.5rem" }}
                      />
                    ) : null}
                    <div style={{ display: "grid", gap: "0.3rem" }}>
                      {r.answerList.slice(0, 3).map((a) => (
                        <div key={`${r.submissionId}-${a.questionId}`} style={{ fontSize: "0.82rem" }}>
                          <strong>{a.questionTitle}:</strong> {a.answer || "-"}
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            {filteredRows.length === 0 && <div style={{ color: "var(--muted)", paddingTop: "0.7rem" }}>Filtreye uygun kayıt bulunamadı.</div>}
          </div>
        )}
      </div>

      {selectedRow && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedSubmissionId(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(10,20,35,0.45)", display: "grid", placeItems: "center", padding: "1rem", zIndex: 50 }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(980px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
              <div>
                <h3 style={{ margin: 0 }}>Kayıt Detayı #{selectedRow.submissionId.slice(0, 8)}</h3>
                <div style={{ color: "var(--muted)", fontSize: "0.84rem" }}>{selectedRow.dateText} {selectedRow.timeText}</div>
              </div>
              <button type="button" className="btn" onClick={() => setSelectedSubmissionId(null)}>Kapat</button>
            </div>
            <div style={{ display: "grid", gap: "0.8rem" }}>
              {selectedRow.answerList.map((a) => {
                const img = getImageSrc(a);
                return (
                  <div key={`${selectedRow.submissionId}-${a.questionId}`} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem" }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{a.questionTitle}</div>
                    {img ? (
                      <a href={img} target="_blank" rel="noreferrer" title="Gorseli buyuk ac">
                        <img src={img} alt={a.questionTitle} style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--border)" }} />
                      </a>
                    ) : (
                      <div>{a.answer || "-"}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
