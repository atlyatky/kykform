import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { BrandLogo } from "../components/BrandLogo";
import { api } from "../api";

type Stat = { id: string; title: string; type: string; answers: Record<string, number> };
type DashboardData = { 
  formId: string; 
  title: string; 
  totalSubmissions: number; 
  choiceAggregates: Record<string, { questionTitle: string; counts: { label: string; count: number }[] }>;
};

export default function FormDashboard() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api<DashboardData>(`/api/forms/${id}/stats`);
        if (!cancel) setData(res);
      } catch (err) { console.error(err); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [id]);

  if (loading) return <div className="layout">Yükleniyor...</div>;
  if (!data) return <div className="layout">Veri bulunamadı.</div>;

  const formNo = `FRM-${data.formId.slice(-6).toUpperCase()}`;

  return (
    <div className="layout">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <BrandLogo />
          <div>
            <Link to="/" style={{ fontSize: "0.86rem", color: "var(--muted)" }}>← Listeye Dön</Link>
            <h1 style={{ margin: "0.35rem 0 0" }}>{data.title} - Analiz</h1>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Form No: {formNo}</div>
          </div>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-title">Toplam Yanıt Sayısı</div>
          <div className="stat-value">{data.totalSubmissions}</div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "1.5rem" }}>
        {data.choiceAggregates && Object.entries(data.choiceAggregates).map(([qId, s]) => {
          const chartData = s.counts.map(c => ({ name: c.label, count: c.count }));
          return (
            <div key={qId} className="card" style={{ display: "flex", flexDirection: "column" }}>
              <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: "1.1rem", color: "var(--text)" }}>{s.questionTitle}</h3>
              <div style={{ height: 250, width: "100%", marginTop: "auto" }}>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "var(--surface-soft)" }} contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--muted)" }}>Henüz veri yok</div>
                )}
              </div>
            </div>
          );
        })}
        {(!data.choiceAggregates || Object.keys(data.choiceAggregates).length === 0) && (
          <div className="card" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
            Bu formda henüz analiz edilecek çoktan seçmeli veya tekli seçim sorusu bulunmuyor.
          </div>
        )}
      </div>
    </div>
  );
}
