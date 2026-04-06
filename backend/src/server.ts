import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import { z } from "zod";
import { hashPassword, signToken, verifyPassword, verifyToken } from "./auth.js";
import { sendMail } from "./mail.js";
import { prisma } from "./prisma.js";
import { runSlaCheckOnce } from "./sla.js";

const app = express();
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
// IP kısıtı (adminNetwork.ts) Docker arkasında yanlış IP görüp sürekli 403 verdiği için kapalı.
// Gerekirse ters vekil / güvenlik duvarı ile sınırlandırın.

const publicBase = process.env.PUBLIC_FORM_BASE_URL ?? "http://localhost:5173";

function authMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const p = verifyToken(req.headers.authorization);
  if (p) (req as express.Request & { adminId: string }).adminId = p.sub;
  next();
}

const optionSchema = z.object({ id: z.string(), label: z.string(), parentOptionIds: z.array(z.string()).optional(), score: z.number().optional() });
const rowSchema = z.object({ id: z.string(), label: z.string() });
const showWhenSchema = z.object({ questionId: z.string(), optionIds: z.array(z.string()) }).nullable().optional();
const questionInputSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["TEXT", "TEXTAREA", "SINGLE_CHOICE", "MULTI_CHOICE", "NUMBER", "DATE", "FILE", "GRID", "PAGE_BREAK", "AGREEMENT"]),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  required: z.boolean().optional(),
  options: z.array(optionSchema).optional(),
  rows: z.array(rowSchema).optional(),
  showWhen: showWhenSchema,
});

function parseEmails(json: string): string[] {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

app.post("/api/auth/register", async (req, res) => {
  const count = await prisma.admin.count();
  if (count > 0) return res.status(403).json({ error: "Kayıt kapalı" });
  const body = z.object({ email: z.string().email(), password: z.string().min(6) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Geçersiz veri" });
  const admin = await prisma.admin.create({
    data: { email: body.data.email.toLowerCase(), passwordHash: await hashPassword(body.data.password) },
  });
  res.json({ token: signToken(admin.id, admin.email), email: admin.email });
});

app.post("/api/auth/login", async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Geçersiz veri" });
  const admin = await prisma.admin.findUnique({ where: { email: body.data.email.toLowerCase() } });
  if (!admin || !(await verifyPassword(body.data.password, admin.passwordHash))) {
    return res.status(401).json({ error: "E-posta veya şifre hatalı" });
  }
  res.json({ token: signToken(admin.id, admin.email), email: admin.email });
});

app.get("/api/forms", authMiddleware, async (_req, res) => {
  const forms = await prisma.form.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { submissions: true, questions: true } } },
  });
  res.json(forms.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    slug: f.slug,
    published: f.published,
    revision: f.revision,
    periodUnit: f.periodUnit,
    periodValue: f.periodValue,
    expectedSubmissions: f.expectedSubmissions,
    invalidAlertEnabled: f.invalidAlertEnabled,
    slaHours: f.slaHours,
    notifyEmails: parseEmails(f.notifyEmails),
    submissionCount: f._count.submissions,
    questionCount: f._count.questions,
    updatedAt: f.updatedAt,
  })));
});

app.post("/api/forms", authMiddleware, async (req, res) => {
  const body = z.object({ title: z.string().min(1),
  description: z.string().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Geçersiz veri" });
  const base = body.data.title.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
  const form = await prisma.form.create({
    data: { title: body.data.title, description: body.data.description ?? null, slug: `${base || "form"}-${nanoid(8)}` },
  });
  res.status(201).json({ id: form.id, slug: form.slug });
});

function parseQuotaEntities(json: string): string[] {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function serializeForm(form: {
  id: string; title: string; description: string | null; slug: string; published: boolean; revision: number;
  periodUnit: string; periodValue: number; expectedSubmissions: number; invalidAlertEnabled: boolean; slaHours: number | null; notifyEmails: string;
  quotaQuestionId: string | null; quotaEntityListJson: string;
  questions: Array<{ id: string; type: string; title: string; description: string | null; required: boolean; optionsJson: string; rowsJson: string | null; showWhenJson: string | null; orderIndex: number }>;
}) {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    slug: form.slug,
    published: form.published,
    revision: form.revision,
    periodUnit: form.periodUnit,
    periodValue: form.periodValue,
    expectedSubmissions: form.expectedSubmissions,
    invalidAlertEnabled: form.invalidAlertEnabled,
    slaHours: form.slaHours,
    notifyEmails: parseEmails(form.notifyEmails),
    quotaQuestionId: form.quotaQuestionId,
    quotaEntities: parseQuotaEntities(form.quotaEntityListJson),
    questions: form.questions.map((q) => ({
      id: q.id,
      type: q.type,
      title: q.title, description: q.description,
      required: q.required,
      options: JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string; parentOptionIds?: string[]; score?: number }>,
      rows: JSON.parse(q.rowsJson || "[]") as Array<{ id: string; label: string }>,
      showWhen: q.showWhenJson ? (JSON.parse(q.showWhenJson) as { questionId: string; optionIds: string[] }) : null,
      orderIndex: q.orderIndex,
    })),
  };
}

app.get("/api/forms/:id", authMiddleware, async (req, res) => {
  const form = await prisma.form.findUnique({ where: { id: req.params.id }, include: { questions: { orderBy: { orderIndex: "asc" } } } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });
  res.json(serializeForm(form));
});

app.patch("/api/forms/:id", authMiddleware, async (req, res) => {
  const body = z.object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    published: z.boolean().optional(),
    slaHours: z.number().int().positive().nullable().optional(),
    notifyEmails: z.array(z.string().email()).optional(),
    periodUnit: z.enum(["NONE", "DAY", "MONTH", "YEAR"]).optional(),
    periodValue: z.number().int().min(1).optional(),
    expectedSubmissions: z.number().int().min(1).optional(),
    invalidAlertEnabled: z.boolean().optional(),
    quotaQuestionId: z.string().nullable().optional(),
    quotaEntities: z.array(z.string()).optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Geçersiz veri" });
  const data: Record<string, unknown> = { revision: { increment: 1 } };
  if (body.data.title !== undefined) data.title = body.data.title;
  if (body.data.description !== undefined) data.description = body.data.description;
  if (body.data.published !== undefined) data.published = body.data.published;
  if (body.data.slaHours !== undefined) data.slaHours = body.data.slaHours;
  if (body.data.notifyEmails !== undefined) data.notifyEmails = JSON.stringify(body.data.notifyEmails);
  if (body.data.periodUnit !== undefined) data.periodUnit = body.data.periodUnit;
  if (body.data.periodValue !== undefined) data.periodValue = body.data.periodValue;
  if (body.data.expectedSubmissions !== undefined) data.expectedSubmissions = body.data.expectedSubmissions;
  if (body.data.invalidAlertEnabled !== undefined) data.invalidAlertEnabled = body.data.invalidAlertEnabled;
  if (body.data.quotaQuestionId !== undefined) data.quotaQuestionId = body.data.quotaQuestionId;
  if (body.data.quotaEntities !== undefined) data.quotaEntityListJson = JSON.stringify(body.data.quotaEntities);

  try {
    const form = await prisma.form.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, id: form.id, revision: form.revision });
  } catch {
    res.status(404).json({ error: "Bulunamadı" });
  }
});

app.put("/api/forms/:id/questions", authMiddleware, async (req, res) => {
  const parsed = z.array(questionInputSchema).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Geçersiz soru listesi" });
  const formId = req.params.id;
  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });

  const existing = await prisma.question.findMany({ where: { formId }, select: { id: true } });
  const existingSet = new Set(existing.map((q) => q.id));

  const kept: string[] = [];
  await prisma.$transaction(async (tx) => {
    let order = 0;
    for (const q of parsed.data) {
      const common = {
        orderIndex: order++, type: q.type, title: q.title, description: q.description ?? null, required: q.required ?? false,
        optionsJson: JSON.stringify(q.options ?? []),
        rowsJson: JSON.stringify(q.rows ?? []),
        showWhenJson: q.showWhen ? JSON.stringify(q.showWhen) : null,
      };
      if (q.id && existingSet.has(q.id)) {
        await tx.question.update({ where: { id: q.id }, data: common });
        kept.push(q.id);
      } else {
        const created = await tx.question.create({ data: { formId, ...common } });
        kept.push(created.id);
      }
    }
    if (kept.length === 0) await tx.question.deleteMany({ where: { formId } });
    else await tx.question.deleteMany({ where: { formId, id: { notIn: kept } } });
    await tx.form.update({ where: { id: formId }, data: { revision: { increment: 1 } } });
  });

  const updated = await prisma.form.findUnique({ where: { id: formId }, include: { questions: { orderBy: { orderIndex: "asc" } } } });
  res.json(serializeForm(updated!));
});

app.delete("/api/forms/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.form.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Bulunamadı" });
  }
});

app.get("/api/forms/:id/qr", authMiddleware, async (req, res) => {
  const form = await prisma.form.findUnique({ where: { id: req.params.id } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });
  const url = `${publicBase.replace(/\/$/, "")}/f/${form.slug}`;
  const fmt = req.query.format === "png" ? "png" : "svg";
  if (fmt === "png") res.type("png").send(await QRCode.toBuffer(url, { type: "png", width: 320, margin: 2 }));
  else res.type("svg").send(await QRCode.toString(url, { type: "svg" }));
});

app.get("/api/forms/:id/stats", authMiddleware, async (req, res) => {
  const form = await prisma.form.findUnique({ where: { id: req.params.id }, include: { questions: { orderBy: { orderIndex: "asc" } }, submissions: { orderBy: { createdAt: "asc" } } } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });

  const questions = form.questions.map((q) => ({ id: q.id, title: q.title, description: q.description, type: q.type, options: JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string; score?: number }>, rows: JSON.parse(q.rowsJson || "[]") as Array<{ id: string; label: string }> }));
  const byDay = new Map<string, number>();
  for (const s of form.submissions) {
    const d = s.createdAt.toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const timeline = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));

  const choiceAggregates: Record<string, { questionTitle: string; counts: { label: string; count: number }[] }> = {};
  for (const q of questions) {
    if (q.type !== "SINGLE_CHOICE" && q.type !== "MULTI_CHOICE") continue;
    const labelById = new Map(q.options.map((o) => [o.id, o.label]));
    const counts = new Map<string, number>();
    for (const s of form.submissions) {
      const raw = (JSON.parse(s.answersJson) as Record<string, unknown>)[q.id];
      if (q.type === "SINGLE_CHOICE" && typeof raw === "string") counts.set(labelById.get(raw) ?? raw, (counts.get(labelById.get(raw) ?? raw) ?? 0) + 1);
      if (q.type === "MULTI_CHOICE" && Array.isArray(raw)) for (const id of raw) if (typeof id === "string") counts.set(labelById.get(id) ?? id, (counts.get(labelById.get(id) ?? id) ?? 0) + 1);
    }
    choiceAggregates[q.id] = { questionTitle: q.title, counts: [...counts.entries()].map(([label, count]) => ({ label, count })) };
  }

  const numericSamples: Record<string, number[]> = {};
  for (const q of questions) {
    if (q.type !== "NUMBER") continue;
    const nums: number[] = [];
    for (const s of form.submissions) {
      const v = (JSON.parse(s.answersJson) as Record<string, unknown>)[q.id];
      if (typeof v === "number" && !Number.isNaN(v)) nums.push(v);
      else if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) nums.push(Number(v));
    }
    if (nums.length) numericSamples[q.id] = nums;
  }

  res.json({ formId: form.id, title: form.title, totalSubmissions: form.submissions.length, timeline, choiceAggregates, numericSamples, questions: questions.map((q) => ({ id: q.id, title: q.title, description: q.description, type: q.type })) });
});

app.get("/api/public/forms/:slug", async (req, res) => {
  const form = await prisma.form.findFirst({ where: { slug: req.params.slug }, include: { questions: { orderBy: { orderIndex: "asc" } } } });
  if (!form) return res.status(404).json({ error: "Form bulunamadı" });
  res.json(serializeForm(form));
});

app.post("/api/public/forms/:slug/session", async (req, res) => {
  const body = z.object({ sessionKey: z.string().min(8).max(200) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "sessionKey gerekli" });
  const form = await prisma.form.findFirst({ where: { slug: req.params.slug } });
  if (!form) return res.status(404).json({ error: "Form bulunamadı" });
  await prisma.formSession.upsert({
    where: { formId_sessionKey: { formId: form.id, sessionKey: body.data.sessionKey } },
    create: { formId: form.id, sessionKey: body.data.sessionKey }, update: {},
  });
  res.json({ ok: true });
});

app.post("/api/public/forms/:slug/submit", async (req, res) => {
  const body = z.object({ sessionKey: z.string().min(8).max(200), answers: z.record(z.string(), z.any()) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Geçersiz gönderim" });

  const form = await prisma.form.findFirst({ where: { slug: req.params.slug }, include: { questions: true } });
  if (!form) return res.status(404).json({ error: "Form bulunamadı" });

  const answers = body.data.answers;
  const invalidReasons: string[] = [];
  for (const q of form.questions) {
    if (!q.required) continue;
    const v = answers[q.id];
    if (q.type === "GRID") {
      const rows = JSON.parse(q.rowsJson || "[]") as Array<{ id: string; label: string }>;
      const rowObj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      for (const r of rows) {
        const cell = rowObj[r.id];
        if (cell === undefined || cell === null || cell === "") invalidReasons.push(`Zorunlu matris: ${q.title} (${r.label})`);
      }
      continue;
    }
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) invalidReasons.push(`Zorunlu soru bos: ${q.title}`);
  }

  const submission = await prisma.submission.create({ data: { formId: form.id, answersJson: JSON.stringify(answers) } });
  await prisma.formSession.updateMany({ where: { formId: form.id, sessionKey: body.data.sessionKey }, data: { submittedAt: new Date() } });

  if (form.invalidAlertEnabled && invalidReasons.length) {
    const recipients = parseEmails(form.notifyEmails);
    if (recipients.length) {
      await sendMail(
        recipients,
        `[KYK Form] Uygunsuz cevap bildirimi: ${form.title}`,
        `Form: ${form.title}\nGonderim ID: ${submission.id}\n\n` + invalidReasons.join("\n")
      );
    }
  }

  res.status(201).json({ ok: true, submissionId: submission.id, invalid: invalidReasons.length > 0 });
});

const port = Number(process.env.PORT ?? "4000");
app.listen(port, () => console.log(`API http://0.0.0.0:${port}`));
setInterval(() => runSlaCheckOnce().catch((e) => console.error("SLA check", e)), 60_000);
runSlaCheckOnce().catch((e) => console.error("SLA check", e));
