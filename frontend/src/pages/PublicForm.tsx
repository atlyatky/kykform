import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { api } from "../api";
import { FileText, Grid, ChevronRight, ChevronLeft } from "lucide-react";

type Opt = { id: string; label: string; parentOptionIds?: string[]; score?: number };
type Row = { id: string; label: string };
type QType = "TEXT" | "TEXTAREA" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "NUMBER" | "DATE" | "FILE" | "GRID" | "PAGE_BREAK" | "AGREEMENT";
type Q = { id: string; type: QType; title: string; description: string | null; required: boolean; options: Opt[]; rows?: Row[]; showWhen: { questionId: string; optionIds: string[] } | null; };
type FormPayload = { id: string; formNo?: string | null; title: string; description: string | null; questions: Q[] };

function createId() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeFormPayload(input: FormPayload): FormPayload {
  return {
    ...input,
    questions: (Array.isArray(input.questions) ? input.questions : []).map((q) => ({
      ...q,
      options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
        ...o,
        parentOptionIds: Array.isArray(o.parentOptionIds)
          ? o.parentOptionIds
          : (typeof o.parentOptionIds === "string" && o.parentOptionIds
              ? [o.parentOptionIds]
              : undefined),
      })),
      rows: Array.isArray(q.rows) ? q.rows : [],
      showWhen:
        q.showWhen && Array.isArray(q.showWhen.optionIds)
          ? q.showWhen
          : null,
    })),
  };
}

export default function PublicForm() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [form, setForm] = useState<FormPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const sessionKey = useRef(createId());

  useEffect(() => {
    if (!slug) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const f = await api<FormPayload>(`/api/public/forms/${slug}`);
        if (cancel) return;
        setForm(normalizeFormPayload(f));
        await api(`/api/public/forms/${slug}/session`, { method: "POST", body: JSON.stringify({ sessionKey: sessionKey.current }) });
      } catch { setMsg("Form bulunamadı veya yayında değil."); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [slug]);

  if (loading) return <div className="layout">Yükleniyor...</div>;
  if (!form) return <div className="layout">{msg}</div>;

  const formNo = (form.formNo || "").trim() || `FRM-${form.id.slice(-6).toUpperCase()}`;

  // Pagination logic
  const pages: Q[][] = [[]];
  const pageBreaks: Q[] = [];
  let pageIdx = 0;
  form.questions.forEach(q => {
    if (q.type === "PAGE_BREAK") {
      pageIdx++;
      pages[pageIdx] = [];
      pageBreaks.push(q);
    } else {
      pages[pageIdx].push(q);
    }
  });

  const currentQuestions = pages[currentPage] || [];
  const totalPages = pages.length;
  const currentPageBreak = currentPage > 0 ? pageBreaks[currentPage - 1] : null;

  const visibleQuestions = currentQuestions.filter((q) => {
    if (!q.showWhen) return true;
    const parentAnswer = answers[q.showWhen.questionId];
    if (!parentAnswer) return false;
    const ansArray = Array.isArray(parentAnswer) ? parentAnswer : [parentAnswer];
    return q.showWhen.optionIds.some((id) => ansArray.includes(id));
  });

  const canGoNext = () => {
    return visibleQuestions.every(q => {
      if (!q.required) return true;
      const val = answers[q.id];
      if (q.type === "AGREEMENT") return val === true;
      if (q.type === "GRID") {
        if (!val || typeof val !== 'object') return false;
        return (q.rows || []).every(r => val[r.id] !== undefined && val[r.id] !== "");
      }
      if (val === undefined || val === null || val === "") return false;
      if (Array.isArray(val) && val.length === 0) return false;
      return true;
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (currentPage < totalPages - 1) {
      if (canGoNext()) setCurrentPage(p => p + 1);
      else alert("Lütfen bu sayfadaki zorunlu alanları doldurun.");
      return;
    }
    if (!slug) return;
    setSubmitting(true); setMsg("");
    try {
      await api(`/api/public/forms/${slug}/submit`, { method: "POST", body: JSON.stringify({ sessionKey: sessionKey.current, answers }) });
      setMsg("Yanıtınız başarıyla kaydedildi. Teşekkür ederiz.");
      setForm(null);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Hata oluştu."); }
    finally { setSubmitting(false); }
  }

  const handleFileChange = (qId: string, file: File | null) => {
    if (!file) {
      setAnswers(a => { const copy = {...a}; delete copy[qId]; return copy; });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setAnswers(a => ({ ...a, [qId]: e.target?.result }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="layout" style={{ maxWidth: 720, margin: "0 auto", padding: "1rem 1rem 3rem" }}>
      
      <div className="card" style={{ 
        borderTop: "10px solid var(--primary)", 
        borderTopLeftRadius: "12px", 
        borderTopRightRadius: "12px", 
        marginBottom: "1rem", 
        padding: "1.25rem 1.25rem", 
        textAlign: "center", 
        position: "relative", 
        overflow: "hidden",
        boxShadow: "0 8px 30px rgba(23,50,81,0.06)"
      }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "70px", background: "linear-gradient(180deg, var(--surface-soft) 0%, rgba(255,255,255,0) 100%)", zIndex: 0, pointerEvents: "none" }} />
        
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "inline-block", padding: "0.55rem 1rem", background: "var(--surface)", borderRadius: "12px", boxShadow: "0 6px 14px rgba(20,91,168,0.10)", marginBottom: "0.8rem" }}>
            <BrandLogo height={42} />
          </div>
          
          <h1 style={{ margin: "0 0 0.45rem 0", fontSize: "1.45rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
            {form.title}
          </h1>
          
          <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", alignItems: "center", marginBottom: form.description ? "0.6rem" : "0" }}>
            <span className="badge" style={{ fontSize: "0.85rem", padding: "0.4rem 1rem", background: "var(--surface2)", color: "var(--primary)", border: "none", fontWeight: 600 }}>
              Form No: {formNo}
            </span>
          </div>
          
          {form.description && (
            <div style={{ color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45, maxWidth: "95%", margin: "0 auto" }}>
              {form.description}
            </div>
          )}
        </div>
      </div>

      {msg && <div className="card" style={{ marginBottom: "2rem", padding: "1.5rem", borderLeft: "4px solid var(--success)", textAlign: "center", fontWeight: 500, fontSize: "1.1rem", boxShadow: "0 8px 30px rgba(23,50,81,0.06)" }}>{msg}</div>}

      {form && (
        <form className="card" onSubmit={submit} style={{ padding: "2.5rem 2rem", borderRadius: "12px", boxShadow: "0 8px 30px rgba(23,50,81,0.06)", height: "fit-content", overflow: "visible" }}>
          
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
              <div style={{ flex: 1, height: "6px", background: "var(--surface2)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", background: "var(--primary)", width: `${((currentPage + 1) / totalPages) * 100}%`, transition: "width 0.3s ease" }} />
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--muted)" }}>
                Sayfa {currentPage + 1} / {totalPages}
              </div>
            </div>
          )}

          {currentPageBreak && (
            <div style={{ marginBottom: "2.5rem", paddingBottom: "1.5rem", borderBottom: "2px solid var(--surface2)" }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--primary)", margin: "0 0 0.5rem 0" }}>
                {currentPageBreak.title}
              </h2>
              {currentPageBreak.description && (
                <div style={{ fontSize: "1.05rem", color: "var(--muted)", lineHeight: 1.6 }}>
                  {currentPageBreak.description}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {visibleQuestions.length === 0 && (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)", fontStyle: "italic", background: "var(--surface-soft)", borderRadius: "8px", border: "1px dashed var(--border)" }}>
                Bu sayfada görüntülenecek soru bulunmuyor. İlerleyebilirsiniz.
              </div>
            )}
            {visibleQuestions.map((q, qi) => {
              const filteredOptions = q.options.filter((o) => {
                if (!o.parentOptionIds?.length) return true;
                const parentSingles = form.questions.filter((pq) => pq.type === "SINGLE_CHOICE" && form.questions.findIndex((x) => x.id === pq.id) < form.questions.findIndex((x) => x.id === q.id));
                return parentSingles.some((pq) => {
                  const ans = answers[pq.id];
                  return ans && o.parentOptionIds!.includes(ans);
                });
              });

              // Calculate absolute question number (ignoring page breaks for numbering)
              const absoluteIndex = form.questions.filter(x => x.type !== "PAGE_BREAK").findIndex(x => x.id === q.id) + 1;

              return (
                <div key={q.id} style={{ paddingBottom: "2rem", borderBottom: qi < visibleQuestions.length - 1 ? "1px solid var(--surface2)" : "none" }}>
                  {q.type !== "AGREEMENT" && (
                    <label style={{ display: "block", marginBottom: "1rem", fontWeight: 600, fontSize: "1.1rem", color: "var(--text)" }}>
                      <span style={{ color: "var(--primary)", marginRight: "0.5rem" }}>{absoluteIndex}.</span>
                      {q.title} {q.required && <span style={{ color: "var(--danger)" }}>*</span>}
                    </label>
                  )}
                  
                  {q.type === "TEXT" && <input className="input" style={{ fontSize: "1rem", padding: "0.6rem 0.8rem" }} required={q.required} value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />}
                  {q.type === "TEXTAREA" && <textarea className="input" style={{ fontSize: "1rem", padding: "0.6rem 0.8rem" }} rows={4} required={q.required} value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />}
                  {q.type === "NUMBER" && <input className="input" style={{ fontSize: "1rem", padding: "0.6rem 0.8rem" }} type="number" required={q.required} value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: Number(e.target.value) }))} />}
                  {q.type === "DATE" && <input className="input" style={{ fontSize: "1rem", padding: "0.6rem 0.8rem" }} type="date" required={q.required} value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />}
                  
                  {q.type === "AGREEMENT" && (
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "1rem", cursor: "pointer", padding: "1.5rem", background: answers[q.id] ? "var(--surface2)" : "var(--surface-soft)", border: answers[q.id] ? "1px solid var(--primary)" : "1px solid var(--border)", borderRadius: "8px", transition: "all 0.2s ease" }}>
                      <input type="checkbox" style={{ transform: "scale(1.3)", marginTop: "0.3rem" }} required={q.required} checked={answers[q.id] || false} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.checked }))} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text)", marginBottom: "0.3rem" }}>
                          {q.title} {q.required && <span style={{ color: "var(--danger)" }}>*</span>}
                        </div>
                        {q.description && <div style={{ fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.5 }}>{q.description}</div>}
                      </div>
                    </label>
                  )}

                  {q.type === "FILE" && (
                    <div style={{ background: "var(--surface-soft)", padding: "1.5rem", borderRadius: "8px", border: "1px dashed var(--border)", textAlign: "center" }}>
                      <FileText size={32} style={{ color: "var(--muted)", marginBottom: "1rem" }} />
                      <input type="file" className="input" style={{ maxWidth: "300px", margin: "0 auto" }} required={q.required} onChange={(e) => handleFileChange(q.id, e.target.files?.[0] || null)} />
                      {answers[q.id] && <div style={{ fontSize: "0.9rem", color: "var(--success)", marginTop: "0.8rem", fontWeight: 500 }}>Dosya başarıyla eklendi.</div>}
                    </div>
                  )}
                  
                  {q.type === "GRID" && (
                    <div style={{ overflowX: "auto", background: "var(--surface)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                        <thead>
                          <tr>
                            <th style={{ padding: "1rem", borderBottom: "2px solid var(--border)", textAlign: "left", background: "var(--surface-soft)", width: "30%" }}></th>
                            {q.options.map(o => (
                              <th key={o.id} style={{ padding: "1rem 0.5rem", borderBottom: "2px solid var(--border)", textAlign: "center", background: "var(--surface-soft)", fontWeight: 600, color: "var(--text)", minWidth: "80px" }}>
                                {o.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(q.rows || []).map((r, ri) => (
                            <tr key={r.id} style={{ background: ri % 2 === 0 ? "var(--surface)" : "var(--surface-soft)" }}>
                              <td style={{ padding: "1rem", borderBottom: "1px solid var(--border)", fontWeight: 500, color: "var(--text)" }}>
                                {r.label}
                              </td>
                              {q.options.map(o => (
                                <td key={o.id} style={{ padding: "1rem 0.5rem", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                                  <label style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100%", cursor: "pointer" }}>
                                    <input 
                                      type="radio" 
                                      name={`${q.id}_${r.id}`} 
                                      style={{ transform: "scale(1.3)", cursor: "pointer" }} 
                                      checked={answers[q.id]?.[r.id] === o.id} 
                                      onChange={() => setAnswers(a => ({ ...a, [q.id]: { ...(a[q.id] || {}), [r.id]: o.id } }))} 
                                    />
                                  </label>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {q.type === "SINGLE_CHOICE" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                      {filteredOptions.map((o) => (
                        <label key={o.id} style={{ display: "flex", alignItems: "center", gap: "0.8rem", cursor: "pointer", padding: "0.8rem 1rem", background: answers[q.id] === o.id ? "var(--surface2)" : "var(--surface-soft)", border: answers[q.id] === o.id ? "1px solid var(--primary)" : "1px solid var(--border)", borderRadius: "8px", transition: "all 0.2s ease" }}>
                          <input type="radio" name={q.id} style={{ transform: "scale(1.2)" }} required={q.required} checked={answers[q.id] === o.id} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} />
                          <span style={{ fontSize: "1rem", fontWeight: answers[q.id] === o.id ? 600 : 400, color: answers[q.id] === o.id ? "var(--primary)" : "var(--text)" }}>{o.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  
                  {q.type === "MULTI_CHOICE" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                      {filteredOptions.map((o) => {
                        const isChecked = (answers[q.id] || []).includes(o.id);
                        return (
                          <label key={o.id} style={{ display: "flex", alignItems: "center", gap: "0.8rem", cursor: "pointer", padding: "0.8rem 1rem", background: isChecked ? "var(--surface2)" : "var(--surface-soft)", border: isChecked ? "1px solid var(--primary)" : "1px solid var(--border)", borderRadius: "8px", transition: "all 0.2s ease" }}>
                            <input type="checkbox" style={{ transform: "scale(1.2)" }} checked={isChecked} onChange={(e) => {
                              setAnswers((a) => {
                                const cur = new Set(a[q.id] || []);
                                if (e.target.checked) cur.add(o.id); else cur.delete(o.id);
                                return { ...a, [q.id]: [...cur] };
                              });
                            }} />
                            <span style={{ fontSize: "1rem", fontWeight: isChecked ? 600 : 400, color: isChecked ? "var(--primary)" : "var(--text)" }}>{o.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          <div style={{ marginTop: "1rem", paddingTop: "2rem", display: "flex", gap: "1rem" }}>
            {currentPage > 0 && (
              <button className="btn btn-ghost" type="button" onClick={() => setCurrentPage(p => p - 1)} style={{ padding: "1rem", fontSize: "1rem", fontWeight: 600, border: "1px solid var(--border)" }}>
                <ChevronLeft size={20} /> Geri
              </button>
            )}
            
            {currentPage < totalPages - 1 ? (
              <button className="btn btn-primary" type="submit" disabled={submitting} style={{ flex: 1, padding: "1rem", fontSize: "1.1rem", fontWeight: 600, borderRadius: "8px", boxShadow: "0 4px 15px rgba(20,91,168,0.2)" }}>
                İleri <ChevronRight size={20} />
              </button>
            ) : (
              <button className="btn btn-primary" type="submit" disabled={submitting} style={{ flex: 1, padding: "1rem", fontSize: "1.1rem", fontWeight: 600, borderRadius: "8px", boxShadow: "0 4px 15px rgba(20,91,168,0.2)" }}>
                {submitting ? "Kaydediliyor..." : "Kaydet"}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
