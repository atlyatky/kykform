import type { Form } from "@prisma/client";
import { prisma } from "./prisma.js";
import { sendMail } from "./mail.js";

function parseEmails(json: string): string[] {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseQuotaEntities(json: string): string[] {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Periyot penceresinin başlangıcı (UTC, takvim günü/ay/yıl) */
function periodStartUtc(form: Form, now: Date): Date {
  const v = Math.max(1, form.periodValue);
  if (form.periodUnit === "DAY") {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    s.setUTCDate(s.getUTCDate() - (v - 1));
    return s;
  }
  if (form.periodUnit === "MONTH") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (v - 1), 1));
  }
  if (form.periodUnit === "YEAR") {
    return new Date(Date.UTC(now.getUTCFullYear() - (v - 1), 0, 1));
  }
  return new Date(0);
}

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
    const deficits: string[] = [];
    for (const ent of entitySet) {
      const c = counts.get(ent) ?? 0;
      if (c < condition.minCount) {
        const label = optionLabelById.get(ent) ?? ent;
        deficits.push(`  • ${label}: ${c} / ${condition.minCount}`);
      }
    }
    if (deficits.length === 0) continue;
    if (!shouldSendNow(rule.lastFiredAt, now)) continue;

    const subject = action.subject?.trim() || `[KYK Form Akış] Eksik kayıt: ${rule.form.title}`;
    const body =
      `Form: ${rule.form.title}\nKural: ${rule.name}\nDönem başlangıcı: ${start.toISOString()}\n\nEksik kayıtlar:\n${deficits.join("\n")}`;

    await sendMail(action.emails, subject, body);
    await prisma.formFlowRule.update({ where: { id: rule.id }, data: { lastFiredAt: now } });
  }
}

export async function runSlaCheckOnce() {
  const forms = await prisma.form.findMany({
    where: { published: true, periodUnit: { not: "NONE" } },
  });

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const form of forms) {
    if (!form.notifyEmails || form.notifyEmails === "[]") continue;

    const start = periodStartUtc(form, now);
    const subs = await prisma.submission.findMany({
      where: { formId: form.id, createdAt: { gte: start } },
    });

    const expected = form.expectedSubmissions;
    let deficitLines: string[] = [];

    if (form.quotaQuestionId) {
      const counts = new Map<string, number>();
      for (const s of subs) {
        let answers: Record<string, unknown> = {};
        try {
          answers = JSON.parse(s.answersJson) as Record<string, unknown>;
        } catch {
          continue;
        }
        const key = entityKeyFromAnswers(answers, form.quotaQuestionId);
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const listed = parseQuotaEntities(form.quotaEntityListJson);
      const toCheck = new Set<string>(listed);
      for (const k of counts.keys()) toCheck.add(k);
      if (listed.length > 0) {
        for (const ent of listed) {
          const c = counts.get(ent) ?? 0;
          if (c < expected) deficitLines.push(`  • ${ent}: ${c} / ${expected} (beklenen)`);
        }
      } else {
        for (const ent of toCheck) {
          const c = counts.get(ent) ?? 0;
          if (c < expected) deficitLines.push(`  • ${ent}: ${c} / ${expected} (beklenen)`);
        }
      }
    } else {
      const total = subs.length;
      if (total < expected) {
        deficitLines.push(`  • Toplam yanıt: ${total} / ${expected} (beklenen)`);
      }
    }

    if (deficitLines.length === 0) continue;

    if (!form.lastPeriodicNotifyAt || form.lastPeriodicNotifyAt < oneDayAgo) {
      const recipients = parseEmails(form.notifyEmails);
      if (recipients.length > 0) {
        const unitStr = form.periodUnit === "DAY" ? "gün" : form.periodUnit === "MONTH" ? "ay" : "yıl";
        const scope = form.quotaQuestionId
          ? `Varlık başına (soru ID: ${form.quotaQuestionId}) en az ${expected} yanıt bekleniyor.\nEksikler:\n${deficitLines.join("\n")}`
          : `Son ${form.periodValue} ${unitStr} içinde en az ${expected} toplam yanıt bekleniyor.\n${deficitLines.join("\n")}`;

        await sendMail(
          recipients,
          `[KYK Form] Eksik kota: ${form.title}`,
          `"${form.title}" formu için kota altında kayıt var.\n\n${scope}\n\nDönem başı: ${start.toISOString()}`
        );
        await prisma.form.update({
          where: { id: form.id },
          data: { lastPeriodicNotifyAt: now },
        });
      }
    }
  }

  await runFlowRules(now);
}
