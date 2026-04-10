import { prisma } from "./prisma.js";
import { notify, type TeamsReportPayload } from "./notify.js";
import { formatDateTimeTr, formatTimeTr, slaPeriodStart } from "./datetime-tr.js";

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

function shouldSendNow(lastFiredAt: Date | null, now: Date, hhmm: string | undefined): boolean {
  if (!lastFiredAt) return true;
  const sameDay =
    lastFiredAt.getFullYear() === now.getFullYear() &&
    lastFiredAt.getMonth() === now.getMonth() &&
    lastFiredAt.getDate() === now.getDate();
  if (!sameDay) return true;
  const raw = (hhmm ?? "09:00").trim();
  const [h, m] = raw.split(":").map((x) => Number(x));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
  const scheduledToday = new Date(now);
  scheduledToday.setHours(h, m, 0, 0);
  return lastFiredAt < scheduledToday && now >= scheduledToday;
}

function shouldRunAtTime(now: Date, hhmm: string | undefined): boolean {
  const raw = (hhmm ?? "09:00").trim();
  const [h, m] = raw.split(":").map((x) => Number(x));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return true;
  return now.getHours() === h && now.getMinutes() === m;
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

    const start = slaPeriodStart(condition.periodUnit, condition.periodValue, now);
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
    const latestByEntity = new Map<string, Date>();
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
      const prev = latestByEntity.get(key);
      if (!prev || s.createdAt > prev) latestByEntity.set(key, s.createdAt);
    }

    const targets = (condition.entities ?? []).map((x) => x.trim()).filter(Boolean);
    const allOptionIds = Array.from(optionLabelById.keys());
    const entitySet = new Set<string>();
    if (targets.length > 0) {
      for (const t of targets) entitySet.add(t);
    } else if (allOptionIds.length > 0) {
      // Varlik secimi bos ise soru seceneklerindeki tum varliklari raporla.
      for (const optionId of allOptionIds) entitySet.add(optionId);
    } else {
      for (const k of counts.keys()) entitySet.add(k);
    }
    const statusRows: string[][] = [];
    const deficits: string[] = [];
    for (const ent of entitySet) {
      const c = counts.get(ent) ?? 0;
      const label = optionLabelById.get(ent) ?? ent;
      const ok = c >= condition.minCount;
      const latest = latestByEntity.get(ent);
      const timeText = latest ? formatTimeTr(latest) : "-";
      statusRows.push([label, ok ? "Dolduruldu ✅" : "Doldurulmadı ❌", timeText]);
      if (c < condition.minCount) {
        deficits.push(`• ${label}: ${c} / ${condition.minCount}`);
      }
    }
    if (!shouldSendNow(rule.lastFiredAt, now, condition.reportTime)) continue;

    const subject = action.subject?.trim() || `[KYK Form Rapor] Doldurulmadı kontrolü: ${rule.form.title}`;
    const reportPayload: TeamsReportPayload = {
      sections: [
        {
          title: "Özet",
          columns: ["Alan", "Değer"],
          rows: [
            ["Form", rule.form.title],
            ["Kural", rule.name],
            ["Rapor saati", condition.reportTime ?? "09:00"],
            ["Dönem başlangıcı", formatDateTimeTr(start)],
            ["Toplam varlık", String(entitySet.size)],
          ],
        },
        {
          title: "Varlık durumu",
          columns: ["Varlık", "Durum", "Son kayıt saati (TR)"],
          rows: statusRows.length > 0 ? statusRows : [["(Varlık yok)", "-", "-"]],
        },
      ],
      footnote:
        deficits.length > 0
          ? `Eksik varlık sayısı: ${deficits.length}\n${deficits.slice(0, 8).join("\n")}`
          : "Tüm varlıklar hedefi karşıladı ✅",
    };
    await notify(action.emails, subject, reportPayload);
    await prisma.formFlowRule.update({ where: { id: rule.id }, data: { lastFiredAt: now } });
  }
}

export async function runSlaCheckOnce() {
  const now = new Date();
  await runFlowRules(now);
}
