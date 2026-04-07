import { useEffect, useState } from "react";
import { api } from "../api";
import { AdminHeaderActions } from "../components/AdminHeaderActions";

type FirewallRule = { enabled: boolean; ips: string[] };
type FirewallRules = {
  HOME: FirewallRule;
  FORM_EDITOR: FirewallRule;
  FORM_DASHBOARD: FirewallRule;
};
type FirewallConfigPayload = { rules: FirewallRules; ipPool: string[] };
const IMMUTABLE_IPS = ["93.89.64.133"];
type FormRow = { id: string; title: string; slug: string; published: boolean };

const labels: Record<keyof FirewallRules, string> = {
  HOME: "Ana sayfa / Form listesi",
  FORM_EDITOR: "Form duzenleme",
  FORM_DASHBOARD: "Dashboard / analiz",
};

const emptyRules: FirewallRules = {
  HOME: { enabled: false, ips: [] },
  FORM_EDITOR: { enabled: false, ips: [] },
  FORM_DASHBOARD: { enabled: false, ips: [] },
};

export default function FirewallPage() {
  const [rules, setRules] = useState<FirewallRules>(emptyRules);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [ips, setIps] = useState<string[]>([...IMMUTABLE_IPS]);
  const [newIp, setNewIp] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api<FirewallConfigPayload>("/api/firewall")
      .then((cfg) => {
        const r = cfg.rules ?? emptyRules;
        setRules(r);
        const pool = new Set<string>(cfg.ipPool ?? []);
        IMMUTABLE_IPS.forEach((x) => pool.add(x));
        (Object.keys(r) as Array<keyof FirewallRules>).forEach((k) => (r[k].ips ?? []).forEach((ip) => pool.add(ip)));
        setIps([...pool].filter(Boolean));
      })
      .catch((e) => {
        setErr(e instanceof Error ? `Firewall okunamadi: ${e.message}` : "Firewall okunamadi");
        setIps([...IMMUTABLE_IPS]);
      });

    api<FormRow[]>("/api/forms")
      .then((allForms) => setForms(Array.isArray(allForms) ? allForms : []))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Form listesi okunamadi";
        setErr((prev) => (prev ? `${prev} | ${msg}` : msg));
        setForms([]);
      });
  }, []);

  async function save() {
    setMsg(""); setErr("");
    const payload = (Object.keys(rules) as Array<keyof FirewallRules>).reduce((acc, key) => {
      acc[key] = { ...rules[key], ips: rules[key].ips.map((v) => v.trim()).filter(Boolean) };
      return acc;
    }, {} as FirewallRules);
    try {
      const saved = await api<FirewallConfigPayload>("/api/firewall", {
        method: "PUT",
        body: JSON.stringify({ rules: payload, ipPool: Array.from(new Set([...IMMUTABLE_IPS, ...ips])) }),
      });
      setRules(saved.rules);
      setIps(saved.ipPool ?? ips);
      setMsg("Firewall ayarlari kaydedildi.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Hata");
    }
  }

  return (
    <div className="layout">
      <div className="card" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Firewall</h2>
        <AdminHeaderActions />
      </div>
      {err && (
        <div className="card" style={{ marginBottom: "1rem", border: "1px solid rgba(226,73,73,0.35)", color: "var(--danger)" }}>
          {err}
        </div>
      )}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
          Not: Form listesinde <strong>Yayinla</strong> aciksa form doldurma sayfasi tum IP'lere aciktir. Kapaliysa sadece <strong>Ana sayfa</strong> izni olan IP'ler gorebilir.
        </div>
        <div style={{ marginTop: "0.45rem", fontSize: "0.85rem", color: "var(--primary)" }}>
          Sabit izinli IP (silinemez): <strong>93.89.64.133</strong>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.6rem" }}>
          <input className="input" value={newIp} onChange={(e) => setNewIp(e.target.value)} placeholder="Yeni IP (orn: 172.16.26.27)" />
          <button
            className="btn"
            type="button"
            onClick={() => {
              const ip = newIp.trim();
              if (!ip || ips.includes(ip)) return;
              setIps((s) => [...s, ip]);
              setNewIp("");
            }}
          >
            IP Ekle
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface2)" }}>
                <th style={{ padding: "0.6rem", textAlign: "left" }}>IP</th>
                {(Object.keys(rules) as Array<keyof FirewallRules>).map((key) => (
                  <th key={key} style={{ padding: "0.6rem", textAlign: "center" }}>{labels[key]}</th>
                ))}
                <th style={{ padding: "0.6rem" }} />
              </tr>
            </thead>
            <tbody>
              {ips.map((ip) => (
                <tr key={ip} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.6rem", fontFamily: "monospace" }}>{ip}</td>
                  {(Object.keys(rules) as Array<keyof FirewallRules>).map((key) => (
                    <td key={`${ip}-${key}`} style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={IMMUTABLE_IPS.includes(ip) ? true : (rules[key].ips ?? []).includes(ip)}
                        disabled={IMMUTABLE_IPS.includes(ip) || !rules[key].enabled}
                        onChange={(e) => setRules((s) => {
                          if (IMMUTABLE_IPS.includes(ip)) return s;
                          const curr = new Set(s[key].ips ?? []);
                          if (e.target.checked) curr.add(ip); else curr.delete(ip);
                          return { ...s, [key]: { ...s[key], ips: [...curr] } };
                        })}
                      />
                    </td>
                  ))}
                  <td style={{ textAlign: "right", paddingRight: "0.5rem" }}>
                    <button className="btn btn-icon" type="button" title="IP sil" onClick={() => {
                      if (IMMUTABLE_IPS.includes(ip)) return;
                      setIps((all) => all.filter((x) => x !== ip));
                      setRules((s) => ({
                        HOME: { ...s.HOME, ips: s.HOME.ips.filter((x) => x !== ip) },
                        FORM_EDITOR: { ...s.FORM_EDITOR, ips: s.FORM_EDITOR.ips.filter((x) => x !== ip) },
                        FORM_DASHBOARD: { ...s.FORM_DASHBOARD, ips: s.FORM_DASHBOARD.ips.filter((x) => x !== ip) },
                      }));
                    }} disabled={IMMUTABLE_IPS.includes(ip)}>{IMMUTABLE_IPS.includes(ip) ? "Sabit" : "Sil"}</button>
                  </td>
                </tr>
              ))}
              {ips.length === 0 && <tr><td colSpan={5} style={{ padding: "0.8rem", color: "var(--muted)" }}>IP ekleyin, sonra sayfa izinlerini işaretleyin.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Form doldurma sayfalari (Yayinla durumuna gore)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface2)" }}>
                <th style={{ padding: "0.7rem", textAlign: "left" }}>Form</th>
                <th style={{ padding: "0.7rem", textAlign: "left" }}>Sayfa</th>
                <th style={{ padding: "0.7rem", textAlign: "center" }}>Tum IP Erisimi</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.7rem", fontWeight: 600 }}>{f.title}</td>
                  <td style={{ padding: "0.7rem", fontFamily: "monospace", fontSize: "0.85rem" }}>/f/{f.slug}</td>
                  <td style={{ padding: "0.7rem", textAlign: "center" }}>
                    <span
                      className="badge"
                      style={{
                        background: f.published ? "rgba(24,154,109,0.12)" : "rgba(226,73,73,0.12)",
                        color: f.published ? "var(--success)" : "var(--danger)",
                        border: `1px solid ${f.published ? "rgba(24,154,109,0.35)" : "rgba(226,73,73,0.35)"}`,
                      }}
                    >
                      {f.published ? "ACIK" : "KAPALI"}
                    </span>
                  </td>
                </tr>
              ))}
              {forms.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "0.9rem", color: "var(--muted)" }}>Henuz form yok.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--muted)" }}>
          Bu tablo ana listedeki <strong>Yayinla</strong> butonunu yansitir. ACIK olanlar herkes tarafindan gorulebilir.
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
        <button className="btn btn-primary" type="button" onClick={() => void save()}>Kaydet</button>
        {msg && <span style={{ color: "var(--success)" }}>{msg}</span>}
        {err && <span style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
    </div>
  );
}
