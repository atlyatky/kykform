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
}
