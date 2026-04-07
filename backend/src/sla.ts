import { prisma } from "./prisma.js";
import { notify } from "./notify.js";

function entityKeyFromAnswers(answers: Record<string, unknown>, qid: string): string {
  const raw = answers[qid];
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") return String(raw);
  return String(raw);
}

type FlowMissingQuotaCondition = {
  kind: "MISSING_ENTITY_QUOTA";
  questionId: string;
  periodUnit: "DAY" | "MONTH" | "YEAR";
  periodValue: number;
  minCount: number;
  entities?: string[];
  weekdays?: number[];
  reportTime?: string;
};
type FlowAnswerLabelMatchCondition = {
  kind: "ANSWER_LABEL_MATCH";
  questionIds: string[];
  expectedLabel: string;
  mode?: "ANY" | "ALL";
};
type FlowCondition = FlowMissingQuotaCondition | FlowAnswerLabelMatchCondition;

type FlowAction = {
  kind: "SEND_EMAIL";
  emails: string[];
  subject?: string;
  messageTemplate?: string;
};

function periodStartByParts(unit: "DAY" | "MONTH" | "YEAR", value: number, now: Date): Date {
  const v = Math.max(1, value);
  if (unit === "DAY") {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    s.setUTCDate(s.getUTCDate() - (v - 1));
    return s;
  }
  if (unit === "MONTH") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (v - 1), 1));
  return new Date(Date.UTC(now.getUTCFullYear() - (v - 1), 0, 1));
}

function shouldSendNow(lastFiredAt: Date | null, now: Date): boolean {
  if (!lastFiredAt) return true;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return lastFiredAt < oneDayAgo;
}

function shouldRunAtTime(now: Date, hhmm: string | undefined): boolean {
  const raw = (hhmm ?? "09:00").trim();
  const [h, m] = raw.split(":").map((x) => Number(x));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return true;
  return now.getHours() === h && now.getMinutes() === m;
}

function renderTemplate(template: string | undefined, tags: Record<string, string>, fallback: string): string {
  if (!template || !template.trim()) return fallback;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => tags[key] ?? `{${key}}`);
}

async function runFlowRules(now: Date) {
  const rules = await prisma.formFlowRule.findMany({
    where: { enabled: true, trigger: "ON_SCHEDULE", form: { published: true } },
    include: { form: { include: { questions: true } } },
  });
  for (const rule of rules) {
    let condition: FlowCondition | null = null;
    let action: FlowAction | null = null;
    try {
      condition = JSON.parse(rule.conditionJson) as FlowCondition;
      action = JSON.parse(rule.actionJson) as FlowAction;
    } catch {
      continue;
    }
    if (!condition || !action) continue;
    if (condition.kind !== "MISSING_ENTITY_QUOTA" || action.kind !== "SEND_EMAIL") continue;
    if (!condition.questionId || !Array.isArray(action.emails) || action.emails.length === 0) continue;
    const activeWeekdays = Array.isArray(condition.weekdays)
      ? condition.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    if (activeWeekdays.length > 0 && !activeWeekdays.includes(now.getDay())) continue;
    if (!shouldRunAtTime(now, condition.reportTime)) continue;

    const start = periodStartByParts(condition.periodUnit, condition.periodValue, now);
    const subs = await prisma.submission.findMany({ where: { formId: rule.formId, createdAt: { gte: start } } });
    const entityQuestion = rule.form.questions.find((q) => q.id === condition.questionId);
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
    for (const s of subs) {
      let answers: Record<string, unknown> = {};
      try {
        answers = JSON.parse(s.answersJson) as Record<string, unknown>;
      } catch {
        continue;
      }
      const key = entityKeyFromAnswers(answers, condition.questionId);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const targets = (condition.entities ?? []).map((x) => x.trim()).filter(Boolean);
    const entitySet = new Set<string>(targets);
    if (entitySet.size === 0) {
      for (const k of counts.keys()) entitySet.add(k);
    }
    const statusRows: string[] = [];
    const deficits: string[] = [];
    for (const ent of entitySet) {
      const c = counts.get(ent) ?? 0;
      const label = optionLabelById.get(ent) ?? ent;
      const ok = c >= condition.minCount;
      statusRows.push(`| ${ok ? "Dolduruldu ✅" : "Doldurulmadi ❌"} | ${label} | ${c} / ${condition.minCount} |`);
      if (c < condition.minCount) {
        deficits.push(`  • ${label}: ${c} / ${condition.minCount}`);
      }
    }
    if (!shouldSendNow(rule.lastFiredAt, now)) continue;

    const subject = action.subject?.trim() || `[KYK Form Rapor] Doldurulmadi Kontrolu: ${rule.form.title}`;
    const defaultBody = [
      `Form: ${rule.form.title}`,
      `Kural: ${rule.name}`,
      `Rapor saati: ${condition.reportTime ?? "09:00"}`,
      `Dönem başlangıcı: ${start.toISOString()}`,
      "",
      "| Durum | Varlik | Gerceklesen |",
      "|---|---|---|",
      ...statusRows,
      deficits.length > 0 ? `\nEksik varlik sayisi: ${deficits.length}` : "\nTum varliklar hedefi karsiladi ✅",
    ].join("\n");
    const body = renderTemplate(action.messageTemplate, {
      formTitle: rule.form.title,
      ruleName: rule.name,
      periodStart: start.toISOString(),
      deficits: deficits.join("\n"),
      reportTime: condition.reportTime ?? "09:00",
      reportTable: statusRows.join("\n"),
    }, defaultBody);
    await notify(action.emails, subject, body);
    await prisma.formFlowRule.update({ where: { id: rule.id }, data: { lastFiredAt: now } });
  }
}

export async function runSlaCheckOnce() {
  const now = new Date();
  await runFlowRules(now);
}
