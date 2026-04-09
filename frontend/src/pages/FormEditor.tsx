import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Settings2, Trash2, ArrowUp, ArrowDown, Type, AlignLeft, CheckSquare, List, Hash, Calendar, FileText, Grid, Check, SplitSquareHorizontal, ChevronLeft, Save, Eye, SlidersHorizontal, Info } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { api, copyTextToClipboard, publicFormUrl } from "../api";

type Opt = { id: string; label: string; parentOptionIds?: string[]; score?: number };
type Row = { id: string; label: string };
type QType = "TEXT" | "TEXTAREA" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "NUMBER" | "DATE" | "FILE" | "GRID" | "PAGE_BREAK" | "AGREEMENT";
type Q = { id?: string; type: QType; title: string; description?: string | null; required: boolean; options: Opt[]; rows?: Row[]; showWhen: { questionId: string; optionIds: string[] } | null; };
type FlowMissingQuotaCondition = { kind: "MISSING_ENTITY_QUOTA"; questionId: string; periodUnit: "DAY" | "MONTH" | "YEAR"; periodValue: number; minCount: number; entities?: string[]; weekdays?: number[]; reportTime?: string };
type FlowAnswerLabelMatchCondition = { kind: "ANSWER_LABEL_MATCH"; questionIds: string[]; expectedLabel: string; mode: "ANY" | "ALL" };
type FlowCondition = FlowMissingQuotaCondition | FlowAnswerLabelMatchCondition;
type FlowAction = { kind: "SEND_EMAIL"; emails: string[]; subject?: string; messageTemplate?: string };
type FlowRule = { id?: string; name: string; enabled: boolean; trigger: "ON_SCHEDULE" | "ON_SUBMIT"; condition: FlowCondition; action: FlowAction; lastFiredAt?: string | null };

type FormPayload = {
  id: string;
  formNo?: string | null;
  revisionNo?: string | null;
  revisionDate?: string | null;
  title: string; slug: string; published: boolean; revision: number; description: string | null;
  periodUnit: "NONE" | "DAY" | "MONTH" | "YEAR"; periodValue: number; expectedSubmissions: number; invalidAlertEnabled: boolean;
  quotaQuestionId: string | null; quotaEntities: string[];
  questions: Array<{ id: string; type: QType; title: string; description: string | null; required: boolean; options: Opt[]; rows?: Row[]; showWhen: Q["showWhen"] }>;
};

function createId() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
function newOpt(): Opt { return { id: createId(), label: "" }; }
function newRow(): Row { return { id: createId(), label: "" }; }
function newQuestion(type: QType = "TEXT"): Q { return { type, title: type === "PAGE_BREAK" ? "Yeni Bölüm / Sayfa" : "", description: "", required: false, options: type === "SINGLE_CHOICE" || type === "MULTI_CHOICE" || type === "GRID" ? [newOpt(), newOpt()] : [], rows: type === "GRID" ? [newRow(), newRow()] : [], showWhen: null }; }
function newMissingQuotaRule(): FlowRule {
  return {
    name: "Eksik Forklift Kontrolü",
    enabled: true,
    trigger: "ON_SCHEDULE",
    condition: { kind: "MISSING_ENTITY_QUOTA", questionId: "", periodUnit: "DAY", periodValue: 1, minCount: 1, entities: [], weekdays: [1, 2, 3, 4, 5, 6], reportTime: "09:00" },
    action: { kind: "SEND_EMAIL", emails: [], subject: "", messageTemplate: "" },
  };
}
function newAnswerLabelRule(): FlowRule {
  return {
    name: "Kritik secim bildirimi",
    enabled: true,
    trigger: "ON_SUBMIT",
    condition: { kind: "ANSWER_LABEL_MATCH", questionIds: [], expectedLabel: "", mode: "ANY" },
    action: { kind: "SEND_EMAIL", emails: [], subject: "", messageTemplate: "" },
  };
}
function parseWebhookList(values: string[]): string[] {
  return values
    .join("\n")
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

const ICONS: Record<QType, React.ReactNode> = {
  TEXT: <Type size={16} />,
  TEXTAREA: <AlignLeft size={16} />,
  SINGLE_CHOICE: <CheckSquare size={16} />,
  MULTI_CHOICE: <List size={16} />,
  NUMBER: <Hash size={16} />,
  DATE: <Calendar size={16} />,
  FILE: <FileText size={16} />,
  GRID: <Grid size={16} />,
  PAGE_BREAK: <SplitSquareHorizontal size={16} />,
  AGREEMENT: <Check size={16} />
};

const LABELS: Record<QType, string> = {
  TEXT: "Kısa Yanıt",
  TEXTAREA: "Uzun Yanıt",
  SINGLE_CHOICE: "Tekli Seçim",
  MULTI_CHOICE: "Çoklu Seçim",
  NUMBER: "Sayı",
  DATE: "Tarih",
  FILE: "Dosya Yükleme",
  GRID: "Matris / Tablo",
  PAGE_BREAK: "Sayfa Sonu (Bölüm)",
  AGREEMENT: "Onay Kutusu"
};

export default function FormEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState<"toolbox" | "controls" | "general">("toolbox");

  const [meta, setMeta] = useState<Omit<FormPayload, "questions">>({
    id: "", formNo: "", revisionNo: "", revisionDate: null, title: "", slug: "", published: false, revision: 1, description: "",
    periodUnit: "NONE", periodValue: 1, expectedSubmissions: 1, invalidAlertEnabled: false,
    quotaQuestionId: null, quotaEntities: [],
  });
  const [questions, setQuestions] = useState<Q[]>([]);
  const [selectedQIndex, setSelectedQIndex] = useState<number | null>(null);
  const [openOptionLogic, setOpenOptionLogic] = useState<string | null>(null);
  /** Kota varlık listesi — textarea için dizi yerine metin (imleç sıçramasını önler) */
  const [quotaDraft, setQuotaDraft] = useState("");
  const [flowRules, setFlowRules] = useState<FlowRule[]>([]);

  useEffect(() => {
    if (!id) return;
    api<FormPayload>(`/api/forms/${id}`).then(d => {
      const { questions: qs, ...rest } = d;
      const qe = Array.isArray(d.quotaEntities) ? d.quotaEntities : [];
      setMeta({
        ...rest,
        quotaQuestionId: d.quotaQuestionId ?? null,
        quotaEntities: qe,
      });
      setQuotaDraft(qe.join("\n"));
      setQuestions(qs);
      if (qs.length > 0) setSelectedQIndex(0);
    }).then(async () => {
      const rules = await api<FlowRule[]>(`/api/forms/${id}/flows`);
      setFlowRules(
        Array.isArray(rules)
          ? rules.map((r) => {
              if (r.condition.kind === "ANSWER_LABEL_MATCH") {
                return {
                  ...r,
                  trigger: "ON_SUBMIT",
                  condition: {
                    ...r.condition,
                    questionIds: Array.isArray(r.condition.questionIds) ? r.condition.questionIds : [],
                    expectedLabel: r.condition.expectedLabel ?? "",
                    mode: r.condition.mode === "ALL" ? "ALL" : "ANY",
                  },
                action: { ...r.action, messageTemplate: r.action.messageTemplate ?? "" },
                } as FlowRule;
              }
              return {
                ...r,
                trigger: "ON_SCHEDULE",
                condition: {
                  ...r.condition,
                  minCount: 1,
                  entities: Array.isArray(r.condition.entities) ? r.condition.entities : [],
                  weekdays: Array.isArray(r.condition.weekdays) && r.condition.weekdays.length > 0 ? r.condition.weekdays : [1, 2, 3, 4, 5, 6],
                  reportTime: typeof r.condition.reportTime === "string" ? r.condition.reportTime : "09:00",
                },
                action: { ...r.action, messageTemplate: r.action.messageTemplate ?? "" },
              } as FlowRule;
            })
          : []
      );
    }).finally(() => setLoading(false));
  }, [id]);

  const saveAll = async () => {
    if (!id) return;
    setSaving(true); setMsg("");
    try {
      const quotaEntities = quotaDraft.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      await api(`/api/forms/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...meta, quotaEntities }),
      });
      await api(`/api/forms/${id}/questions`, { method: "PUT", body: JSON.stringify(questions) });
      await api(`/api/forms/${id}/flows`, {
        method: "PUT",
        body: JSON.stringify(flowRules.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          trigger: r.trigger,
          condition: r.condition.kind === "MISSING_ENTITY_QUOTA"
            ? {
                ...r.condition,
                minCount: 1,
                entities: (r.condition.entities ?? []).map((x) => x.trim()).filter(Boolean),
                weekdays: (r.condition.weekdays ?? [1, 2, 3, 4, 5, 6]).filter((d) => d >= 0 && d <= 6),
                reportTime: (r.condition.reportTime ?? "09:00"),
              }
            : { ...r.condition, questionIds: r.condition.questionIds.filter(Boolean), expectedLabel: r.condition.expectedLabel.trim() },
          action: {
            ...r.action,
            emails: parseWebhookList(r.action.emails ?? []),
            messageTemplate: (r.action.messageTemplate ?? "").trim(),
          },
        }))),
      });
      setMsg("Değişiklikler kaydedildi.");
      setTimeout(() => setMsg(""), 3000);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Hata"); }
    finally { setSaving(false); }
  };

  const addQuestion = (type: QType) => {
    const q = newQuestion(type);
    setQuestions(prev => [...prev, q]);
    setSelectedQIndex(questions.length);
  };

  const updateQ = (i: number, fn: (q: Q) => Q) => setQuestions(qs => qs.map((q, idx) => idx === i ? fn(q) : q));
  const removeQ = (i: number) => {
    setQuestions(qs => qs.filter((_, idx) => idx !== i));
    if (selectedQIndex === i) setSelectedQIndex(null);
    else if (selectedQIndex !== null && selectedQIndex > i) setSelectedQIndex(selectedQIndex - 1);
  };
  const moveQ = (i: number, dir: -1 | 1) => {
    if (i + dir < 0 || i + dir >= questions.length) return;
    setQuestions(qs => {
      const copy = [...qs];
      [copy[i], copy[i + dir]] = [copy[i + dir], copy[i]];
      return copy;
    });
    if (selectedQIndex === i) setSelectedQIndex(i + dir);
    else if (selectedQIndex === i + dir) setSelectedQIndex(i);
  };

  const selectedQ = selectedQIndex !== null ? questions[selectedQIndex] : null;
  const eligibleEntityQuestions = questions.filter((q) => !!q.id && (q.type === "TEXT" || q.type === "SINGLE_CHOICE" || q.type === "NUMBER"));
  const eligibleChoiceQuestions = questions.filter((q) => !!q.id && (q.type === "SINGLE_CHOICE" || q.type === "MULTI_CHOICE"));
  const questionTitleById = new Map(questions.filter((q) => !!q.id).map((q) => [q.id as string, q.title || "İsimsiz soru"]));
  const periodText = (unit: "DAY" | "MONTH" | "YEAR") => unit === "DAY" ? "günde" : unit === "MONTH" ? "ayda" : "yılda";
  const weekdayLabels: Array<{ value: number; label: string }> = [
    { value: 1, label: "Pzt" },
    { value: 2, label: "Sal" },
    { value: 3, label: "Car" },
    { value: 4, label: "Per" },
    { value: 5, label: "Cum" },
    { value: 6, label: "Cmt" },
    { value: 0, label: "Paz" },
  ];
  const weekdayLong = (v: number) => {
    const map: Record<number, string> = { 0: "Pazar", 1: "Pazartesi", 2: "Sali", 3: "Carsamba", 4: "Persembe", 5: "Cuma", 6: "Cumartesi" };
    return map[v] ?? String(v);
  };
  const sendTest = async (urls: string[], subject?: string, message?: string) => {
    const parsed = parseWebhookList(urls);
    if (parsed.length === 0) return alert("Önce en az 1 webhook URL girin.");
    try {
      await api("/api/notify/test", {
        method: "POST",
        body: JSON.stringify({ urls: parsed, subject, message }),
      });
      alert("Test bildirimi gönderildi.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Test gönderimi başarısız");
    }
  };
  const ruleSentence = (rule: FlowRule) => {
    if (rule.condition.kind === "MISSING_ENTITY_QUOTA") {
      const qTitle = questionTitleById.get(rule.condition.questionId) ?? "seçili varlık";
      const d = (rule.condition.weekdays ?? [1, 2, 3, 4, 5, 6]).map(weekdayLong).join(", ");
      return `${rule.condition.periodValue} ${periodText(rule.condition.periodUnit)} "${qTitle}" sorusundaki secili her varlik icin 1 kayit bekle; ${d} gunlerinde saat ${rule.condition.reportTime ?? "09:00"}'da eksikleri ${parseWebhookList(rule.action.emails ?? []).length} webhook adresine bildir.`;
    }
    const names = rule.condition.questionIds.map((id) => questionTitleById.get(id) ?? "isimsiz soru").join(", ");
    return `"${names || "soru seçin"}" sorularında "${rule.condition.expectedLabel || "değer"}" ${rule.condition.mode === "ALL" ? "hepsinde" : "en az birinde"} seçilirse ${parseWebhookList(rule.action.emails ?? []).length} webhook adresine bildirim at.`;
  };
  const buildRuleTestPayload = (rule: FlowRule): { subject: string; message: string } => {
    const visibleQuestions = questions.filter((q) => q.type !== "PAGE_BREAK");
    const renderQuestionPreview = (q: Q): string[] => {
      if (q.type === "SINGLE_CHOICE" || q.type === "MULTI_CHOICE") {
        const expected = rule.condition.kind === "ANSWER_LABEL_MATCH" ? rule.condition.expectedLabel.trim().toLocaleLowerCase("tr") : "";
        const options = q.options ?? [];
        const chosenId =
          options.find((o) => (o.label || "").trim().toLocaleLowerCase("tr") === expected)?.id ??
          options[0]?.id ??
          "";
        const rows = options.map((o) => {
          const picked = o.id === chosenId;
          const isBad = picked && expected && (o.label || "").trim().toLocaleLowerCase("tr") === expected;
          return `${isBad ? "🔴" : picked ? "🟢" : "⚪"} ${o.label || "Seçenek"}`;
        });
        return rows.length ? rows : ["⚪ (Seçenek yok)"];
      }
      if (q.type === "GRID") {
        const row = q.rows?.[0]?.label || "Satır 1";
        const col = q.options?.[0]?.label || "Seçenek 1";
        return [`🟢 ${row}: ${col}`];
      }
      if (q.type === "AGREEMENT") return ["🟢 Onaylandı"];
      if (q.type === "NUMBER") return ["🟢 1"];
      if (q.type === "DATE") return ["🟢 07.04.2026"];
      if (q.type === "FILE") return ["🟢 dosya.pdf"];
      return ["🟢 Test yanıtı"];
    };

    if (rule.condition.kind === "ANSWER_LABEL_MATCH") {
      const now = new Date();
      const questionRows = visibleQuestions.map((q) => {
        const preview = renderQuestionPreview(q);
        const chosen = preview.find((x) => x.startsWith("🔴") || x.startsWith("🟢")) ?? preview[0] ?? "⚪ (bos)";
        const durum = chosen.startsWith("🔴") ? "🔴 Uygunsuz" : chosen.startsWith("⚪") ? "⚪ Bos" : "🟢 Uygun";
        const yanit = chosen.replace(/^([🔴🟢⚪])\s*/, "");
        return `| ${q.title || "İsimsiz soru"} | ${yanit} | ${durum} |`;
      });
      return {
        subject: "Uygunsuzluk Girişi Yapılmıştır",
        message: [
          "| Alan | Deger |",
          "|---|---|",
          `| Tarih | ${now.toLocaleDateString("tr-TR")} |`,
          `| Saat | ${now.toLocaleTimeString("tr-TR")} |`,
          "| Form Adi | TEST FORM |",
          "",
          "### Formun Dolu Gorunumu",
          "",
          "| Soru | Yanit | Durum |",
          "|---|---|---|",
          ...(questionRows.length ? questionRows : ["| (Formda soru yok) | - | - |"]),
        ].join("\n"),
      };
    }
    const entityQuestion = questions.find((q) => q.id && q.id === rule.condition.questionId);
    const targetEntities =
      (rule.condition.entities ?? []).length > 0
        ? (rule.condition.entities ?? [])
        : (entityQuestion?.options ?? []).map((o) => o.id);
    const optionLabelById = new Map((entityQuestion?.options ?? []).map((o) => [o.id, o.label || o.id]));
    const rows = targetEntities.map((entityId, idx) => {
      const label = optionLabelById.get(entityId) ?? entityId;
      const done = idx % 2 === 0;
      const time = done ? "14:47" : "-";
      return `| ${label} | ${done ? "Dolduruldu ✅" : "Doldurulmadi ❌"} | ${time} |`;
    });
    const missingCount = rows.filter((_, idx) => idx % 2 !== 0).length;
    return {
      subject: `[KYK Form Rapor] Doldurulmadi Kontrolu: TEST FORM`,
      message: [
        "| Alan | Deger |",
        "|---|---|",
        "| Form | TEST FORM |",
        `| Kural | ${rule.name || "Doldurulmadi"} |`,
        `| Rapor saati | ${rule.condition.reportTime ?? "09:00"} |`,
        "| Donem baslangici | 2026-01-01T00:00:00.000Z |",
        `| Toplam varlik | ${targetEntities.length} |`,
        "",
        "| Varlik | Durum | Gelis saati |",
        "|---|---|---|",
        ...(rows.length ? rows : ["| (Varlik yok) | - | - |"]),
        "",
        `Eksik varlik sayisi: ${missingCount}`,
      ].join("\n"),
    };
  };

  if (loading) return <div className="layout">Yükleniyor...</div>;

  return (
    <div className="editor-wrapper">
      <header className="editor-header" style={{ padding: "0 1rem", height: "64px", minHeight: "64px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <Link to="/" style={{ color: "var(--muted)", textDecoration: "none", display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.9rem", fontWeight: 500 }}>
            <ChevronLeft size={18} /> Listeye Dön
          </Link>
          <div style={{ width: "1px", height: "24px", background: "var(--border)" }} />
          <BrandLogo />
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--text)" }}>{meta.title || "İsimsiz Form"}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
            <span style={{ fontWeight: 500, color: "var(--primary)" }}>{meta.formNo?.trim() || `FRM-${meta.id.slice(-6).toUpperCase()}`}</span>
            <span>•</span>
            <span>Rev: {(meta.revisionNo || "").trim() || "-"}</span>
            <span>•</span>
            <span>Tarih: {meta.revisionDate ? new Date(meta.revisionDate).toLocaleDateString("tr-TR") : "-"}</span>
            <span>•</span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: meta.published ? "var(--success)" : "var(--danger)" }} />
              {meta.published ? "Yayında" : "Taslak"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {msg && <span style={{ color: "var(--success)", fontSize: "0.9rem", fontWeight: 500, marginRight: "1rem" }}>{msg}</span>}
          
          <button className="btn btn-ghost" onClick={() => void copyTextToClipboard(publicFormUrl(meta.slug)).then((ok) => alert(ok ? "Form linki kopyalandı." : "Kopyalanamadı; linki elle seçip kopyalayın."))} style={{ padding: "0.5rem 1rem", fontSize: "0.9rem", color: "var(--primary)" }}>
            Link Kopyala
          </button>
          
          <a href={publicFormUrl(meta.slug)} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
            <Eye size={16} /> Önizleme
          </a>
          <button className={meta.published ? "btn btn-ghost" : "btn btn-primary"} onClick={() => setMeta(m => ({ ...m, published: !m.published }))} style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
            {meta.published ? "Yayından Kaldır" : "Yayınla"}
          </button>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving} style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
            <Save size={16} /> {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </header>

      <div className="editor-main">
        {/* Left Sidebar - Toolbox */}
        <div className="editor-sidebar-left">
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <button className={`btn-ghost ${activeTab === "toolbox" ? "active" : ""}`} style={{ flex: "1 1 30%", minWidth: 0, padding: "0.65rem 0.4rem", borderRadius: 0, borderBottom: activeTab === "toolbox" ? "2px solid var(--primary)" : "2px solid transparent", color: activeTab === "toolbox" ? "var(--primary)" : "var(--muted)", fontWeight: 600, fontSize: "0.78rem" }} onClick={() => setActiveTab("toolbox")} title="Soru tipleri">
              Araç
            </button>
            <button className={`btn-ghost ${activeTab === "controls" ? "active" : ""}`} style={{ flex: "1 1 38%", minWidth: 0, padding: "0.65rem 0.4rem", borderRadius: 0, borderBottom: activeTab === "controls" ? "2px solid var(--primary)" : "2px solid transparent", color: activeTab === "controls" ? "var(--primary)" : "var(--muted)", fontWeight: 600, fontSize: "0.78rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }} onClick={() => setActiveTab("controls")} title="Kontroller ve bildirimler">
              <SlidersHorizontal size={14} /> Kontroller
            </button>
            <button className={`btn-ghost ${activeTab === "general" ? "active" : ""}`} style={{ flex: "1 1 30%", minWidth: 0, padding: "0.65rem 0.4rem", borderRadius: 0, borderBottom: activeTab === "general" ? "2px solid var(--primary)" : "2px solid transparent", color: activeTab === "general" ? "var(--primary)" : "var(--muted)", fontWeight: 600, fontSize: "0.78rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }} onClick={() => setActiveTab("general")} title="Başlık ve link">
              <Info size={14} /> Form
            </button>
          </div>

          {activeTab === "toolbox" && (
            <div className="editor-sidebar-section">
              <div className="editor-sidebar-title">Soru Tipleri</div>
              {(Object.keys(LABELS) as QType[]).map(type => (
                <button key={type} className="toolbox-btn" onClick={() => addQuestion(type)} style={type === "PAGE_BREAK" ? { borderTop: "1px dashed var(--border)", marginTop: "1rem" } : {}}>
                  {ICONS[type]} {LABELS[type]}
                </button>
              ))}
            </div>
          )}

          {activeTab === "general" && (
            <div className="editor-sidebar-section">
              <div className="editor-sidebar-title">Form bilgisi</div>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "-0.5rem 0 1rem 0", lineHeight: 1.45 }}>
                Başlık, açıklama ve paylaşım linki. Zorunlu soru ve kota ayarları <strong style={{ color: "var(--text)" }}>Kontroller</strong> sekmesindedir.
              </p>

              <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "var(--surface2)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "var(--primary)", fontSize: "0.9rem" }}>Form paylaşım linki</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input className="input" readOnly value={publicFormUrl(meta.slug)} style={{ flex: 1, fontSize: "0.85rem", background: "var(--surface)", padding: "0.4rem 0.6rem" }} />
                  <button className="btn btn-primary" onClick={() => void copyTextToClipboard(publicFormUrl(meta.slug)).then((ok) => alert(ok ? "Link kopyalandı." : "Kopyalanamadı."))} style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}>Kopyala</button>
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Form numarası (elle)</label>
                <input
                  className="input"
                  placeholder="Orn: FRM-2026-001"
                  value={meta.formNo || ""}
                  onChange={e => setMeta(m => ({ ...m, formNo: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Revizyon no (elle)</label>
                <input
                  className="input"
                  placeholder="Orn: R0 / R1 / A / 01"
                  value={meta.revisionNo || ""}
                  onChange={e => setMeta(m => ({ ...m, revisionNo: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Revizyon tarihi</label>
                <input
                  className="input"
                  type="date"
                  value={(meta.revisionDate || "").slice(0, 10)}
                  onChange={e => setMeta(m => ({ ...m, revisionDate: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }))}
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Form başlığı</label>
                <input className="input" value={meta.title} onChange={e => setMeta(m => ({ ...m, title: e.target.value }))} />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Form açıklaması</label>
                <textarea className="input" rows={3} value={meta.description || ""} onChange={e => setMeta(m => ({ ...m, description: e.target.value }))} />
              </div>
            </div>
          )}

          {activeTab === "controls" && (
            <div className="editor-sidebar-section">
              <div className="editor-sidebar-title">Kurallar &amp; bildirim</div>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "-0.5rem 0 1rem 0", lineHeight: 1.45 }}>
                İki kural tipi var: <strong style={{ color: "var(--text)" }}>Doldurulmadı (saatli günlük rapor)</strong> ve <strong style={{ color: "var(--text)" }}>Uygunsuz Şık (anlık)</strong>.
              </p>

              <div style={{ padding: "1rem", background: "var(--surface2)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--primary)" }}>Akış kuralları</div>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setFlowRules((r) => [...r, newMissingQuotaRule()])}><Plus size={14} /> Doldurulmadı</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setFlowRules((r) => [...r, newAnswerLabelRule()])}><Plus size={14} /> Uygunsuz Şık</button>
                  </div>
                </div>

                {flowRules.length === 0 && <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>Kural yok. Örn: "Günde 1 kez FL-01 için form doldurulmadıysa a@,b@ kişilerine bildir".</div>}

                {flowRules.map((rule, i) => (
                  <div key={rule.id || `flow-${i}`} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem", background: "var(--surface)" }}>
                    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <input className="input" value={rule.name} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} placeholder="Kural adı" />
                      <button type="button" className="btn-icon" title="Sil" onClick={() => setFlowRules((arr) => arr.filter((_, idx) => idx !== i))}><Trash2 size={16} /></button>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, enabled: e.target.checked } : x))} />
                      Kural aktif
                    </label>

                    {rule.condition.kind === "MISSING_ENTITY_QUOTA" ? (
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Belirlenen saatte her gün kontrol edip varlık bazlı dolduruldu/doldurulmadı raporu gönderir.</div>
                        <select className="input" value={rule.condition.questionId} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, condition: { ...x.condition, questionId: e.target.value, entities: [], minCount: 1 } } : x))}>
                          <option value="">Varlık sorusu seçin (örn. forklift no)</option>
                          {eligibleEntityQuestions.map((q) => <option key={q.id} value={q.id}>{q.title || "İsimsiz soru"}</option>)}
                        </select>
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          <input type="number" className="input" min={1} style={{ width: "72px" }} value={rule.condition.periodValue} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, condition: { ...x.condition, periodValue: parseInt(e.target.value) || 1 } } : x))} />
                          <select className="input" style={{ minWidth: "100px" }} value={rule.condition.periodUnit} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, condition: { ...x.condition, periodUnit: e.target.value as FlowMissingQuotaCondition["periodUnit"] } } : x))}>
                            <option value="DAY">Gün</option>
                            <option value="MONTH">Ay</option>
                            <option value="YEAR">Yıl</option>
                          </select>
                          <input
                            type="time"
                            className="input"
                            style={{ minWidth: "120px" }}
                            value={rule.condition.reportTime ?? "09:00"}
                            onChange={(e) => setFlowRules((arr) => arr.map((x, idx) =>
                              idx === i && x.condition.kind === "MISSING_ENTITY_QUOTA"
                                ? { ...x, condition: { ...x.condition, reportTime: e.target.value || "09:00" } }
                                : x
                            ))}
                            title="Raporlama saati"
                          />
                          <div style={{ flex: 1, minWidth: "120px", fontSize: "0.82rem", color: "var(--muted)", display: "flex", alignItems: "center" }}>
                            Her secili varlik icin hedef: <strong style={{ marginLeft: 4, color: "var(--text)" }}>1 kayit</strong>
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: "0.85rem" }}>Kontrol günleri (Pazar kapatılabilir)</label>
                          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
                            {weekdayLabels.map((w) => (
                              <label key={w.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", background: "var(--surface-soft)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.2rem 0.4rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={(rule.condition.weekdays ?? [1, 2, 3, 4, 5, 6]).includes(w.value)}
                                  onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => {
                                    if (idx !== i || x.condition.kind !== "MISSING_ENTITY_QUOTA") return x;
                                    const curr = new Set(x.condition.weekdays ?? [1, 2, 3, 4, 5, 6]);
                                    if (e.target.checked) curr.add(w.value); else curr.delete(w.value);
                                    return { ...x, condition: { ...x.condition, weekdays: [...curr] } };
                                  }))}
                                />
                                {w.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        {(() => {
                          const entityQ = questions.find((q) => q.id === rule.condition.questionId);
                          const optionList = entityQ?.type === "SINGLE_CHOICE" ? (entityQ.options ?? []) : [];
                          if (optionList.length > 0) {
                            return (
                              <div>
                                <label style={{ fontSize: "0.85rem" }}>Varlık listesi (coklu secim)</label>
                                <div style={{ maxHeight: 120, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", marginTop: "0.3rem" }}>
                                  {optionList.map((opt) => (
                                    <label key={opt.id} style={{ display: "flex", gap: "0.4rem", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                                      <input
                                        type="checkbox"
                                        checked={(rule.condition.entities ?? []).includes(opt.id)}
                                        onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => {
                                          if (idx !== i || x.condition.kind !== "MISSING_ENTITY_QUOTA") return x;
                                          const curr = new Set(x.condition.entities ?? []);
                                          if (e.target.checked) curr.add(opt.id); else curr.delete(opt.id);
                                          return { ...x, condition: { ...x.condition, entities: [...curr], minCount: 1 } };
                                        }))}
                                      />
                                      {opt.label || "İsimsiz varlık"}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <textarea
                              className="input"
                              rows={2}
                              value={(rule.condition.entities ?? []).join("\n")}
                              onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, condition: { ...x.condition, entities: e.target.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean), minCount: 1 } } : x))}
                              placeholder={"FL-01\nFL-02 (opsiyonel)"}
                            />
                          );
                        })()}
                        <input className="input" value={(rule.action.emails ?? []).length <= 1 ? ((rule.action.emails ?? [])[0] ?? "") : (rule.action.emails ?? []).join(", ")} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, action: { ...x.action, emails: [e.target.value] } } : x))} placeholder="Teams webhook URL(ler)i" />
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            const p = buildRuleTestPayload(rule);
                            void sendTest(rule.action.emails ?? [], p.subject, p.message);
                          }}
                        >
                          Test Gönder
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Uygunsuz şık seçilirse gönderim anında form raporunu webhooka atar.</div>
                        <label style={{ fontSize: "0.85rem" }}>Sorular</label>
                        <div style={{ maxHeight: 120, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem" }}>
                          {eligibleChoiceQuestions.length === 0 && <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Önce tekli/çoklu seçim sorusu ekleyin.</div>}
                          {eligibleChoiceQuestions.map((q) => (
                            <label key={q.id} style={{ display: "flex", gap: "0.4rem", fontSize: "0.82rem", marginBottom: "0.3rem" }}>
                              <input
                                type="checkbox"
                                checked={rule.condition.questionIds.includes(q.id as string)}
                                onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => {
                                  if (idx !== i || x.condition.kind !== "ANSWER_LABEL_MATCH") return x;
                                  const curr = new Set(x.condition.questionIds);
                                  if (e.target.checked) curr.add(q.id as string); else curr.delete(q.id as string);
                                  return { ...x, condition: { ...x.condition, questionIds: [...curr] } };
                                }))}
                              />
                              {q.title || "İsimsiz soru"}
                            </label>
                          ))}
                        </div>
                        <input className="input" value={rule.condition.expectedLabel} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i && x.condition.kind === "ANSWER_LABEL_MATCH" ? { ...x, condition: { ...x.condition, expectedLabel: e.target.value } } : x))} placeholder="Aranacak şık metni (örn: Ciddi risk)" />
                        <select className="input" value={rule.condition.mode} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i && x.condition.kind === "ANSWER_LABEL_MATCH" ? { ...x, condition: { ...x.condition, mode: e.target.value as "ANY" | "ALL" } } : x))}>
                          <option value="ANY">En az bir soruda seçilirse</option>
                          <option value="ALL">Tüm seçili sorularda seçilirse</option>
                        </select>
                        <input className="input" value={(rule.action.emails ?? []).length <= 1 ? ((rule.action.emails ?? [])[0] ?? "") : (rule.action.emails ?? []).join(", ")} onChange={(e) => setFlowRules((arr) => arr.map((x, idx) => idx === i ? { ...x, action: { ...x.action, emails: [e.target.value] } } : x))} placeholder="Teams webhook URL(ler)i" />
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            const p = buildRuleTestPayload(rule);
                            void sendTest(rule.action.emails ?? [], p.subject, p.message);
                          }}
                        >
                          Test Gönder
                        </button>
                      </div>
                    )}

                    <div style={{ marginTop: "0.6rem", fontSize: "0.78rem", color: "var(--primary)", background: "var(--surface-soft)", borderRadius: 6, padding: "0.5rem" }}>
                      {ruleSentence(rule)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center - Canvas */}
        <div className="editor-canvas">
          <div className="editor-canvas-page">
            {questions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--muted)" }}>
                <Plus size={48} style={{ opacity: 0.2, marginBottom: "1rem" }} />
                <h3>Formunuz henüz boş</h3>
                <p>Sol taraftaki araç kutusundan soru ekleyerek başlayın.</p>
              </div>
            ) : (
              questions.map((q, i) => (
                <div key={q.id || i} className={`editor-question-block ${selectedQIndex === i ? "selected" : ""}`} onClick={() => setSelectedQIndex(i)}>
                  {q.type === "PAGE_BREAK" ? (
                    <div style={{ textAlign: "center", padding: "2rem", background: "var(--surface-soft)", border: "1px dashed var(--border)", borderRadius: "8px", position: "relative" }}>
                      <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: "var(--surface)", padding: "0 1rem", color: "var(--muted)", fontSize: "0.85rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <SplitSquareHorizontal size={14} /> YENİ SAYFA
                      </div>
                      <h3 style={{ margin: "0 0 0.5rem 0", color: "var(--text)" }}>{q.title || "İsimsiz Bölüm"}</h3>
                      {q.description && <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>{q.description}</p>}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" }}>
                        <div style={{ color: "var(--primary)", marginTop: "0.2rem" }}>{ICONS[q.type]}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "var(--text)", marginBottom: "0.25rem" }}>
                            {q.title || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>Soru metni girilmedi</span>}
                            {q.required && <span style={{ color: "var(--danger)", marginLeft: "0.25rem" }}>*</span>}
                          </div>
                          {q.description && <div style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.5rem" }}>{q.description}</div>}
                        </div>
                      </div>
                      
                      {/* Preview of inputs based on type */}
                      <div style={{ opacity: 0.7, pointerEvents: "none" }}>
                        {q.type === "TEXT" && <input className="input" placeholder="Kısa yanıt metni" readOnly />}
                        {q.type === "TEXTAREA" && <textarea className="input" rows={3} placeholder="Uzun yanıt metni" readOnly />}
                        {q.type === "SINGLE_CHOICE" && <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{q.options.map(o => <label key={o.id}><input type="radio" disabled /> {o.label || "Seçenek"}</label>)}</div>}
                        {q.type === "MULTI_CHOICE" && <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{q.options.map(o => <label key={o.id}><input type="checkbox" disabled /> {o.label || "Seçenek"}</label>)}</div>}
                        {q.type === "NUMBER" && <input type="number" className="input" placeholder="Sayı" readOnly />}
                        {q.type === "DATE" && <input type="date" className="input" readOnly />}
                        {q.type === "FILE" && <div style={{ padding: "1rem", border: "1px dashed var(--border)", textAlign: "center", borderRadius: "8px" }}><FileText size={24} style={{ opacity: 0.5 }}/></div>}
                        {q.type === "GRID" && (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                              <thead>
                                <tr>
                                  <th style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", textAlign: "left" }}></th>
                                  {q.options.map(o => <th key={o.id} style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", textAlign: "center", fontWeight: 500 }}>{o.label || "Sütun"}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {(q.rows || []).map(r => (
                                  <tr key={r.id}>
                                    <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--surface2)", fontWeight: 500 }}>{r.label || "Satır"}</td>
                                    {q.options.map(o => <td key={o.id} style={{ padding: "0.5rem", borderBottom: "1px solid var(--surface2)", textAlign: "center" }}><input type="radio" disabled /></td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {q.type === "AGREEMENT" && <label style={{ display: "flex", gap: "0.5rem" }}><input type="checkbox" disabled /> Onay metni</label>}
                      </div>
                    </>
                  )}
                  
                  {/* Actions overlay */}
                  <div className="editor-question-actions" style={{ position: "absolute", top: "1rem", right: "1rem", display: selectedQIndex === i ? "flex" : "none", gap: "0.25rem", background: "var(--surface)", padding: "0.25rem", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); moveQ(i, -1); }} disabled={i === 0}><ArrowUp size={16} /></button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); moveQ(i, 1); }} disabled={i === questions.length - 1}><ArrowDown size={16} /></button>
                    <div style={{ width: "1px", background: "var(--border)", margin: "0 0.25rem" }} />
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); removeQ(i); }} style={{ color: "var(--danger)" }}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Sidebar - Properties */}
        <div className="editor-sidebar-right">
          {selectedQ ? (
            <div className="editor-sidebar-section">
              <div className="editor-sidebar-title">
                {selectedQ.type === "PAGE_BREAK" ? "Bölüm Ayarları" : "Soru Özellikleri"}
              </div>
              
              <div style={{ marginBottom: "1rem" }}>
                <label>{selectedQ.type === "PAGE_BREAK" ? "Bölüm Başlığı" : "Soru Metni"}</label>
                <textarea className="input" rows={2} value={selectedQ.title} onChange={(e) => updateQ(selectedQIndex!, q => ({ ...q, title: e.target.value }))} />
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Açıklama (İsteğe Bağlı)</label>
                <textarea className="input" rows={3} value={selectedQ.description || ""} onChange={(e) => updateQ(selectedQIndex!, q => ({ ...q, description: e.target.value }))} />
              </div>

              {selectedQ.type !== "PAGE_BREAK" && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedQ.required} onChange={(e) => updateQ(selectedQIndex!, q => ({ ...q, required: e.target.checked }))} />
                    Bu soru zorunlu
                  </label>
                </div>
              )}

              {selectedQ.type === "GRID" && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label>Satırlar (Değerlendirilecek Öğeler)</label>
                  {(selectedQ.rows || []).map((r, ri) => (
                    <div key={r.id} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <input className="input" value={r.label} onChange={(e) => updateQ(selectedQIndex!, q => {
                        const nr = [...(q.rows || [])];
                        nr[ri].label = e.target.value;
                        return { ...q, rows: nr };
                      })} placeholder="Satır metni" />
                      <button className="btn-icon" onClick={() => updateQ(selectedQIndex!, q => ({ ...q, rows: (q.rows || []).filter((_, idx) => idx !== ri) }))}><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button className="btn btn-ghost" style={{ width: "100%", marginTop: "0.5rem", border: "1px dashed var(--border)" }} onClick={() => updateQ(selectedQIndex!, q => ({ ...q, rows: [...(q.rows || []), newRow()] }))}>
                    <Plus size={16} /> Satır Ekle
                  </button>
                </div>
              )}

              {(selectedQ.type === "SINGLE_CHOICE" || selectedQ.type === "MULTI_CHOICE" || selectedQ.type === "GRID") && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label>{selectedQ.type === "GRID" ? "Sütunlar (Seçenekler)" : "Seçenekler"}</label>
                  {selectedQ.options.map((o, oi) => {
                    const parentChoices = questions.slice(0, selectedQIndex!).filter(pq => pq.type === "SINGLE_CHOICE");
                    return (
                      <div key={o.id} style={{ marginBottom: "1rem", padding: "0.5rem", background: "var(--surface-soft)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                          <input className="input" value={o.label} onChange={(e) => updateQ(selectedQIndex!, q => {
                            const no = [...q.options];
                            no[oi].label = e.target.value;
                            return { ...q, options: no };
                          })} placeholder="Seçenek metni" />
                          <button className="btn-icon" onClick={() => updateQ(selectedQIndex!, q => ({ ...q, options: q.options.filter((_, idx) => idx !== oi) }))}><Trash2 size={16} /></button>
                        </div>
                        
                        {parentChoices.length > 0 && (
                          <div style={{ marginTop: "0.5rem" }}>
                            <button className="btn btn-ghost" style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem", color: (o.parentOptionIds && o.parentOptionIds.length > 0) ? "var(--primary)" : "var(--muted)" }} onClick={() => setOpenOptionLogic(openOptionLogic === o.id ? null : o.id)}>
                              <Settings2 size={14} style={{ marginRight: "0.25rem" }} /> 
                              {(o.parentOptionIds && o.parentOptionIds.length > 0) ? "Mantık Ayarlandı" : "Mantık Ekle"}
                            </button>
                            
                            {openOptionLogic === o.id && (
                              <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                                <div style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.85rem", color: "var(--primary)" }}>Bu seçeneği şu cevap(lar) seçiliyse göster:</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                  {parentChoices.map(pq => (
                                    pq.options.map(po => (
                                      <label key={po.id} style={{ display: "flex", alignItems: "center", gap: "0.25rem", background: "var(--surface2)", padding: "0.3rem 0.6rem", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "0.85rem", cursor: "pointer" }}>
                                        <input type="checkbox" checked={(o.parentOptionIds || []).includes(po.id)} onChange={(e) => {
                                          updateQ(selectedQIndex!, q => {
                                            const no = [...q.options];
                                            const curr = new Set(no[oi].parentOptionIds || []);
                                            if (e.target.checked) curr.add(po.id); else curr.delete(po.id);
                                            no[oi].parentOptionIds = [...curr];
                                            return { ...q, options: no };
                                          });
                                        }} />
                                        {po.label || "İsimsiz"}
                                      </label>
                                    ))
                                  ))}
                                </div>
                                <div style={{ fontSize: "0.75rem", marginTop: "0.5rem", opacity: 0.7 }}>Hiçbiri seçilmezse bu seçenek her zaman gösterilir.</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button className="btn btn-ghost" style={{ width: "100%", marginTop: "0.5rem", border: "1px dashed var(--border)" }} onClick={() => updateQ(selectedQIndex!, q => ({ ...q, options: [...q.options, newOpt()] }))}>
                    <Plus size={16} /> Seçenek Ekle
                  </button>
                </div>
              )}

              {selectedQ.type !== "PAGE_BREAK" && (
                <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
                  <label style={{ color: "var(--primary)", fontWeight: 600 }}>Görünürlük Şartı (Mantık)</label>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.5rem 0 1rem 0" }}>Bu soruyu, önceki bir sorunun cevabına göre gösterin.</p>
                  
                  <select className="input" style={{ marginBottom: "1rem" }} value={selectedQ.showWhen?.questionId || ""} onChange={(e) => {
                    const val = e.target.value;
                    if (!val) updateQ(selectedQIndex!, q => ({ ...q, showWhen: null }));
                    else updateQ(selectedQIndex!, q => ({ ...q, showWhen: { questionId: val, optionIds: [] } }));
                  }}>
                    <option value="">Her zaman göster</option>
                    {questions.slice(0, selectedQIndex!).filter(q => q.type === "SINGLE_CHOICE" || q.type === "MULTI_CHOICE").map(q => (
                      <option key={q.id} value={q.id}>{q.title || "İsimsiz Soru"}</option>
                    ))}
                  </select>

                  {selectedQ.showWhen && (
                    <div style={{ background: "var(--surface-soft)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      <label style={{ fontSize: "0.9rem", marginBottom: "0.5rem", display: "block" }}>Şu cevap(lar) seçildiğinde göster:</label>
                      {questions.find(q => q.id === selectedQ.showWhen?.questionId)?.options.map(o => (
                        <label key={o.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
                          <input type="checkbox" checked={selectedQ.showWhen!.optionIds.includes(o.id)} onChange={(e) => {
                            updateQ(selectedQIndex!, q => {
                              const curr = new Set(q.showWhen!.optionIds);
                              if (e.target.checked) curr.add(o.id); else curr.delete(o.id);
                              return { ...q, showWhen: { ...q.showWhen!, optionIds: [...curr] } };
                            });
                          }} />
                          {o.label || "İsimsiz Seçenek"}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
              <Settings2 size={48} style={{ opacity: 0.2, marginBottom: "1rem" }} />
              <p>Özelliklerini düzenlemek için ortadaki alandan bir soru seçin.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
