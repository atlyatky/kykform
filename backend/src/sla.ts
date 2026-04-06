import { prisma } from "./prisma.js";
import { sendMail } from "./mail.js";

export async function runSlaCheckOnce() {
  const forms = await prisma.form.findMany({
    where: { published: true, periodUnit: { not: "NONE" } },
  });

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const form of forms) {
    if (!form.notifyEmails || form.notifyEmails === "[]") continue;

    let start = new Date(now);
    if (form.periodUnit === "DAY") {
      start.setDate(start.getDate() - form.periodValue);
    } else if (form.periodUnit === "MONTH") {
      start.setMonth(start.getMonth() - form.periodValue);
    } else if (form.periodUnit === "YEAR") {
      start.setFullYear(start.getFullYear() - form.periodValue);
    }

    const subs = await prisma.submission.count({
      where: { formId: form.id, createdAt: { gte: start } },
    });

    if (subs < form.expectedSubmissions) {
      if (!form.lastPeriodicNotifyAt || form.lastPeriodicNotifyAt < oneDayAgo) {
        const recipients = JSON.parse(form.notifyEmails) as string[];
        if (recipients.length > 0) {
          const unitStr = form.periodUnit === "DAY" ? "gün" : form.periodUnit === "MONTH" ? "ay" : "yıl";
          await sendMail(
            recipients,
            `[KYK Form] Eksik Form Bildirimi: ${form.title}`,
            `"${form.title}" formu için beklenen yanıt sayısına ulaşılamadı.\n\n` +
            `Kural: Son ${form.periodValue} ${unitStr} içinde en az ${form.expectedSubmissions} yanıt bekleniyor.\n` +
            `Mevcut Yanıt: ${subs}`
          );
          await prisma.form.update({
            where: { id: form.id },
            data: { lastPeriodicNotifyAt: now },
          });
        }
      }
    }
  }
}
