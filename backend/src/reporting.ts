import { prisma } from "./prisma.js";
import {
  formatDateTimeTr,
  formatDateTr,
  formatTimeTr,
  getYmdInIstanbul,
  startOfIstanbulCalendarDay,
} from "./datetime-tr.js";

export type ReportCategoryKey = "vinc" | "forklift" | "transpalet";

export const REPORT_CATEGORIES: Array<{
  key: ReportCategoryKey;
  label: string;
  titlePatterns: RegExp[];
}> = [
  {
    key: "vinc",
    label: "Vinç Kontrol Formu",
    titlePatterns: [/vinç/i, /vinc/i],
  },
  {
    key: "forklift",
    label: "Forklift Kontrol Formu",
    titlePatterns: [/forklift/i],
  },
  {
    key: "transpalet",
    label: "Elektrikli (Akülü) Transpalet Günlük Kontrol Formu",
    titlePatterns: [/transpalet/i, /akülü/i, /akulu/i, /akü/i, /akulu/i],
  },
];

type QuestionRow = {
  id: string;
  title: string;
  type: string;
  optionsJson: string;
  rowsJson: string | null;
};

type EntityQuotaConfig = {
  questionId: string;
  entities: string[];
  minCount: number;
};

type ComplianceConfig = {
  questionIds: string[];
  expectedLabel: string;
  mode: "ANY" | "ALL";
};

export type EntityStatusRow = {
  entityId: string;
  label: string;
  submitted: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

export type ComplianceIssue = {
  questionId: string;
  questionTitle: string;
  answer: string;
  status: "Uygunsuz" | "Uygun" | "Boş";
};

export type NonCompliantSubmission = {
  submissionId: string;
  createdAt: string;
  entityLabel: string | null;
  issues: ComplianceIssue[];
};

export type FormDailyReport = {
  key: ReportCategoryKey;
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
  allSubmissions: Array<{
    submissionId: string;
    createdAt: string;
    entityLabel: string | null;
    compliant: boolean;
  }>;
};

export type DailyReportsPayload = {
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

function parseQuotaEntities(json: string): string[] {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function normalizeText(v: string): string {
  return v.trim().toLocaleLowerCase("tr");
}

function entityKeyFromAnswers(answers: Record<string, unknown>, qid: string): string {
  const raw = answers[qid];
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") return String(raw);
  return String(raw);
}

function extractSelectedLabels(q: { optionsJson: string }, rawAnswer: unknown): string[] {
  const options = JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string }>;
  const labelById = new Map(options.map((o) => [o.id, o.label]));
  const out: string[] = [];
  if (typeof rawAnswer === "string") out.push(labelById.get(rawAnswer) ?? rawAnswer);
  else if (Array.isArray(rawAnswer)) {
    for (const x of rawAnswer) {
      if (typeof x === "string") out.push(labelById.get(x) ?? x);
    }
  }
  return out;
}

function formatAnswerForReport(q: QuestionRow, rawAnswer: unknown): string {
  const options = JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string }>;
  const optionLabel = new Map(options.map((o) => [o.id, o.label || o.id]));
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === "") return "(bos)";
  if (q.type === "FILE") return "Dosya eklendi";
  if (typeof rawAnswer === "string") return optionLabel.get(rawAnswer) ?? rawAnswer;
  if (typeof rawAnswer === "number" || typeof rawAnswer === "boolean") return String(rawAnswer);
  if (Array.isArray(rawAnswer)) {
    return rawAnswer.map((x) => (typeof x === "string" ? (optionLabel.get(x) ?? x) : String(x))).join(", ");
  }
  if (q.type === "GRID" && typeof rawAnswer === "object") {
    const rows = JSON.parse(q.rowsJson || "[]") as Array<{ id: string; label: string }>;
    const rowMap = rawAnswer as Record<string, unknown>;
    return rows
      .map((r) => `${r.label}: ${optionLabel.get(String(rowMap[r.id])) ?? String(rowMap[r.id] ?? "(bos)")}`)
      .join(" | ");
  }
  try {
    const s = JSON.stringify(rawAnswer);
    return s.length > 200 ? `${s.slice(0, 200)}...` : s;
  } catch {
    return String(rawAnswer);
  }
}

export function parseReportDate(dateStr?: string): { y: number; m: number; day: number; iso: string } {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, day] = dateStr.split("-").map(Number);
    if (y > 0 && m >= 1 && m <= 12 && day >= 1 && day <= 31) {
      return { y, m, day, iso: dateStr };
    }
  }
  const { y, m, day } = getYmdInIstanbul(new Date());
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { y, m, day, iso };
}

export function dayRange(y: number, m: number, day: number): { start: Date; end: Date } {
  const start = startOfIstanbulCalendarDay(y, m, day);
  const end = new Date(start.getTime() + 86400000 - 1);
  return { start, end };
}

function resolveEntityQuotaConfig(
  form: { quotaQuestionId: string | null; quotaEntityListJson: string; expectedSubmissions: number },
  flowRules: Array<{ trigger: string; conditionJson: string }>
): EntityQuotaConfig | null {
  for (const rule of flowRules) {
    if (rule.trigger !== "ON_SCHEDULE") continue;
    try {
      const condition = JSON.parse(rule.conditionJson) as {
        kind?: string;
        questionId?: string;
        entities?: string[];
        minCount?: number;
      };
      if (condition.kind === "MISSING_ENTITY_QUOTA" && condition.questionId) {
        return {
          questionId: condition.questionId,
          entities: (condition.entities ?? []).map((x) => x.trim()).filter(Boolean),
          minCount: Math.max(1, condition.minCount ?? 1),
        };
      }
    } catch {
      continue;
    }
  }
  if (form.quotaQuestionId) {
    return {
      questionId: form.quotaQuestionId,
      entities: parseQuotaEntities(form.quotaEntityListJson),
      minCount: Math.max(1, form.expectedSubmissions || 1),
    };
  }
  return null;
}

function resolveComplianceConfig(
  flowRules: Array<{ trigger: string; conditionJson: string }>
): ComplianceConfig | null {
  for (const rule of flowRules) {
    if (rule.trigger !== "ON_SUBMIT") continue;
    try {
      const condition = JSON.parse(rule.conditionJson) as {
        kind?: string;
        questionIds?: string[];
        expectedLabel?: string;
        mode?: "ANY" | "ALL";
      };
      if (condition.kind !== "ANSWER_LABEL_MATCH") continue;
      const questionIds = Array.isArray(condition.questionIds) ? condition.questionIds : [];
      const expectedLabel = (condition.expectedLabel ?? "").trim();
      if (!questionIds.length || !expectedLabel) continue;
      return {
        questionIds,
        expectedLabel,
        mode: condition.mode === "ALL" ? "ALL" : "ANY",
      };
    } catch {
      continue;
    }
  }
  return null;
}

function entityLabelForKey(
  key: string,
  entityQuestion: QuestionRow | undefined,
  optionLabelById: Map<string, string>
): string {
  return optionLabelById.get(key) ?? key;
}

function submissionIsNonCompliant(
  questions: QuestionRow[],
  answers: Record<string, unknown>,
  config: ComplianceConfig | null
): { nonCompliant: boolean; issues: ComplianceIssue[] } {
  if (!config) return { nonCompliant: false, issues: [] };
  const expected = normalizeText(config.expectedLabel);
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const checks = config.questionIds.map((qid) => {
    const q = questionById.get(qid);
    if (!q) return false;
    return extractSelectedLabels(q, answers[qid]).some((label) => normalizeText(label) === expected);
  });
  const matched =
    config.mode === "ALL"
      ? checks.length > 0 && checks.every(Boolean)
      : checks.some(Boolean);
  if (!matched) return { nonCompliant: false, issues: [] };

  const issues: ComplianceIssue[] = [];
  for (const qid of config.questionIds) {
    const q = questionById.get(qid);
    if (!q) continue;
    const answer = formatAnswerForReport(q, answers[qid]);
    const selected = extractSelectedLabels(q, answers[qid]).map((x) => normalizeText(x));
    const isNonConforming = selected.includes(expected);
    if (isNonConforming) {
      issues.push({
        questionId: q.id,
        questionTitle: q.title,
        answer,
        status: "Uygunsuz",
      });
    }
  }
  return { nonCompliant: true, issues };
}

function buildEntityRows(
  quota: EntityQuotaConfig | null,
  entityQuestion: QuestionRow | undefined,
  submissions: Array<{ id: string; answersJson: string; createdAt: Date }>
): EntityStatusRow[] {
  const optionLabelById = new Map<string, string>();
  if (entityQuestion) {
    try {
      const opts = JSON.parse(entityQuestion.optionsJson || "[]") as Array<{ id: string; label: string }>;
      for (const o of opts) optionLabelById.set(o.id, o.label || o.id);
    } catch {
      // no-op
    }
  }

  const counts = new Map<string, number>();
  const latestByEntity = new Map<string, Date>();
  for (const s of submissions) {
    let answers: Record<string, unknown> = {};
    try {
      answers = JSON.parse(s.answersJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const key = quota ? entityKeyFromAnswers(answers, quota.questionId) : "__whole_form__";
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const prev = latestByEntity.get(key);
    if (!prev || s.createdAt > prev) latestByEntity.set(key, s.createdAt);
  }

  if (!quota) {
    const total = submissions.length;
    return [
      {
        entityId: "__daily__",
        label: "Günlük form",
        submitted: total >= 1,
        submissionCount: total,
        lastSubmittedAt: submissions[0]?.createdAt.toISOString() ?? null,
      },
    ];
  }

  const minCount = quota.minCount;
  const entitySet = new Set<string>();
  if (quota.entities.length > 0) {
    for (const t of quota.entities) entitySet.add(t);
  } else if (optionLabelById.size > 0) {
    for (const optionId of optionLabelById.keys()) entitySet.add(optionId);
  } else {
    for (const k of counts.keys()) entitySet.add(k);
  }

  return Array.from(entitySet).map((ent) => {
    const c = counts.get(ent) ?? 0;
    const latest = latestByEntity.get(ent);
    return {
      entityId: ent,
      label: entityLabelForKey(ent, entityQuestion, optionLabelById),
      submitted: c >= minCount,
      submissionCount: c,
      lastSubmittedAt: latest ? latest.toISOString() : null,
    };
  });
}

export async function buildDailyReports(dateStr?: string): Promise<DailyReportsPayload> {
  const { y, m, day, iso } = parseReportDate(dateStr);
  const { start, end } = dayRange(y, m, day);
  const dateLabel = formatDateTr(start);

  const allForms = await prisma.form.findMany({
    select: { id: true, title: true, slug: true },
    orderBy: { updatedAt: "desc" },
  });

  const reports: FormDailyReport[] = [];

  for (const cat of REPORT_CATEGORIES) {
    const formMeta = allForms.find((f) => cat.titlePatterns.some((p) => p.test(f.title)));
    if (!formMeta) {
      reports.push({
        key: cat.key,
        label: cat.label,
        found: false,
        formId: null,
        formTitle: null,
        slug: null,
        entities: [],
        summary: {
          totalEntities: 0,
          submittedCount: 0,
          missingCount: 0,
          nonCompliantCount: 0,
          totalSubmissions: 0,
        },
        nonCompliantSubmissions: [],
        allSubmissions: [],
      });
      continue;
    }

    const form = await prisma.form.findUnique({
      where: { id: formMeta.id },
      include: {
        questions: { orderBy: { orderIndex: "asc" } },
        flowRules: { where: { enabled: true } },
      },
    });
    if (!form) {
      reports.push({
        key: cat.key,
        label: cat.label,
        found: false,
        formId: null,
        formTitle: null,
        slug: null,
        entities: [],
        summary: {
          totalEntities: 0,
          submittedCount: 0,
          missingCount: 0,
          nonCompliantCount: 0,
          totalSubmissions: 0,
        },
        nonCompliantSubmissions: [],
        allSubmissions: [],
      });
      continue;
    }

    const submissions = await prisma.submission.findMany({
      where: { formId: form.id, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: "desc" },
    });

    const quota = resolveEntityQuotaConfig(form, form.flowRules);
    const compliance = resolveComplianceConfig(form.flowRules);
    const entityQuestion = quota
      ? form.questions.find((q) => q.id === quota.questionId)
      : undefined;

    const optionLabelById = new Map<string, string>();
    if (entityQuestion) {
      try {
        const opts = JSON.parse(entityQuestion.optionsJson || "[]") as Array<{ id: string; label: string }>;
        for (const o of opts) optionLabelById.set(o.id, o.label || o.id);
      } catch {
        // no-op
      }
    }

    const entities = buildEntityRows(quota, entityQuestion, submissions);
    const submittedCount = entities.filter((e) => e.submitted).length;
    const missingCount = entities.filter((e) => !e.submitted).length;

    const nonCompliantSubmissions: NonCompliantSubmission[] = [];
    const allSubmissions: FormDailyReport["allSubmissions"] = [];

    for (const s of submissions) {
      let answers: Record<string, unknown> = {};
      try {
        answers = JSON.parse(s.answersJson) as Record<string, unknown>;
      } catch {
        continue;
      }
      const entityKey = quota ? entityKeyFromAnswers(answers, quota.questionId) : null;
      const entityLabel = entityKey
        ? entityLabelForKey(entityKey, entityQuestion, optionLabelById)
        : null;
      const { nonCompliant, issues } = submissionIsNonCompliant(form.questions, answers, compliance);
      allSubmissions.push({
        submissionId: s.id,
        createdAt: s.createdAt.toISOString(),
        entityLabel,
        compliant: !nonCompliant,
      });
      if (nonCompliant) {
        nonCompliantSubmissions.push({
          submissionId: s.id,
          createdAt: s.createdAt.toISOString(),
          entityLabel,
          issues,
        });
      }
    }

    reports.push({
      key: cat.key,
      label: cat.label,
      found: true,
      formId: form.id,
      formTitle: form.title,
      slug: form.slug,
      entities,
      summary: {
        totalEntities: entities.length,
        submittedCount,
        missingCount,
        nonCompliantCount: nonCompliantSubmissions.length,
        totalSubmissions: submissions.length,
      },
      nonCompliantSubmissions,
      allSubmissions,
    });
  }

  const totals = {
    missingCount: reports.reduce((a, r) => a + r.summary.missingCount, 0),
    submittedCount: reports.reduce((a, r) => a + r.summary.submittedCount, 0),
    nonCompliantCount: reports.reduce((a, r) => a + r.summary.nonCompliantCount, 0),
  };

  return {
    date: iso,
    dateLabel,
    generatedAt: new Date().toISOString(),
    reports,
    totals,
  };
}

export function formatDailyReportEmailText(payload: DailyReportsPayload): string {
  const lines: string[] = [
    "KYK GÜNLÜK KONTROL RAPORU",
    `Tarih: ${payload.dateLabel}`,
    `Oluşturulma: ${formatDateTimeTr(new Date(payload.generatedAt))}`,
    "",
    "=== ÖZET ===",
    `Gönderilen varlık/form: ${payload.totals.submittedCount}`,
    `Eksik (gönderilmedi): ${payload.totals.missingCount}`,
    `Uygunsuz kayıt: ${payload.totals.nonCompliantCount}`,
    "",
  ];

  for (const r of payload.reports) {
    lines.push(`--- ${r.label} ---`);
    if (!r.found) {
      lines.push("Form bulunamadı (başlıkta ilgili anahtar kelime yok).");
      lines.push("");
      continue;
    }
    lines.push(`Form: ${r.formTitle}`);
    lines.push(
      `Özet: ${r.summary.submittedCount}/${r.summary.totalEntities} gönderildi, ${r.summary.missingCount} eksik, ${r.summary.nonCompliantCount} uygunsuz`
    );
    lines.push("");
    lines.push("Varlık durumu:");
    if (r.entities.length === 0) {
      lines.push("  (kayıt yok)");
    } else {
      for (const e of r.entities) {
        const time = e.lastSubmittedAt ? formatTimeTr(new Date(e.lastSubmittedAt)) : "-";
        lines.push(
          `  • ${e.label}: ${e.submitted ? "Gönderildi" : "Gönderilmedi"} (${e.submissionCount} kayıt, son: ${time})`
        );
      }
    }
    if (r.nonCompliantSubmissions.length > 0) {
      lines.push("");
      lines.push("Uygunsuz kayıtlar:");
      for (const s of r.nonCompliantSubmissions) {
        const ent = s.entityLabel ? ` [${s.entityLabel}]` : "";
        lines.push(`  • ${formatTimeTr(new Date(s.createdAt))}${ent}`);
        for (const issue of s.issues) {
          lines.push(`      - ${issue.questionTitle}: ${issue.answer}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("— KYK Form Otomasyonu");
  return lines.join("\n");
}
