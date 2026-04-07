import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import { z } from "zod";
import { hashPassword, signToken, verifyPassword, verifyToken } from "./auth.js";
import { notify } from "./notify.js";
import { prisma } from "./prisma.js";
import { runSlaCheckOnce } from "./sla.js";

const app = express();
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
const IMMUTABLE_ALLOW_IPS = ["93.89.64.133"];
// IP kısıtı (adminNetwork.ts) Docker arkasında yanlış IP görüp sürekli 403 verdiği için kapalı.
// Gerekirse ters vekil / güvenlik duvarı ile sınırlandırın.

const publicBase = process.env.PUBLIC_FORM_BASE_URL ?? "http://localhost:5173";

function authMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const p = verifyToken(req.headers.authorization);
  if (p) {
    (req as express.Request & { adminId: string; role?: string }).adminId = p.sub;
    (req as express.Request & { adminId: string; role?: string }).role = p.role;
  }
  next();
}
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const adminId = (req as express.Request & { adminId?: string }).adminId;
  if (!adminId) return res.status(401).json({ error: "Oturum gerekli" });
  next();
}
async function requireRole(role: "ADMIN" | "USER", req: express.Request, res: express.Response, next: express.NextFunction) {
  const adminId = (req as express.Request & { adminId?: string }).adminId;
  if (!adminId) return res.status(401).json({ error: "Oturum gerekli" });
  const row = await prisma.admin.findUnique({ where: { id: adminId }, select: { role: true } });
  if (!row) return res.status(401).json({ error: "Oturum gerekli" });
  if (row.role !== role) return res.status(403).json({ error: "Bu sayfaya sadece admin girebilir" });
  next();
}
const requireAdminRole = (req: express.Request, res: express.Response, next: express.NextFunction) =>
  void requireRole("ADMIN", req, res, next);

type FirewallPageKey = "HOME" | "FORM_EDITOR" | "FORM_DASHBOARD";
type FirewallRule = { enabled: boolean; ips: string[] };
type FirewallRules = Record<FirewallPageKey, FirewallRule>;
type FirewallConfigPayload = { rules: FirewallRules; ipPool: string[] };
const defaultFirewallRules: FirewallRules = {
  HOME: { enabled: false, ips: [] },
  FORM_EDITOR: { enabled: false, ips: [] },
  FORM_DASHBOARD: { enabled: false, ips: [] },
};
function normalizeIp(raw: string | undefined): string {
  if (!raw) return "";
  const v = raw.trim();
  if (v.startsWith("::ffff:")) return v.slice(7);
  return v;
}
function readClientIp(req: express.Request): string {
  return normalizeIp(req.ip || req.socket?.remoteAddress || "");
}
function ipAllowed(ip: string, allowList: string[]): boolean {
  const n = normalizeIp(ip);
  if (IMMUTABLE_ALLOW_IPS.map(normalizeIp).includes(n)) return true;
  return allowList.map(normalizeIp).includes(n);
}
async function getFirewallRules(): Promise<FirewallRules> {
  const row = await prisma.firewallConfig.findUnique({ where: { id: "main" } });
  if (!row) return defaultFirewallRules;
  try {
    const parsed = JSON.parse(row.rulesJson) as Partial<FirewallRules> | Partial<FirewallConfigPayload>;
    const maybeRules = (parsed as Partial<FirewallConfigPayload>).rules ?? (parsed as Partial<FirewallRules>);
    return {
      HOME: maybeRules.HOME ?? defaultFirewallRules.HOME,
      FORM_EDITOR: maybeRules.FORM_EDITOR ?? defaultFirewallRules.FORM_EDITOR,
      FORM_DASHBOARD: maybeRules.FORM_DASHBOARD ?? defaultFirewallRules.FORM_DASHBOARD,
    };
  } catch {
    return defaultFirewallRules;
  }
}
async function getFirewallConfig(): Promise<FirewallConfigPayload> {
  const row = await prisma.firewallConfig.findUnique({ where: { id: "main" } });
  if (!row) return { rules: defaultFirewallRules, ipPool: [...IMMUTABLE_ALLOW_IPS] };
  try {
    const parsed = JSON.parse(row.rulesJson) as Partial<FirewallRules> | Partial<FirewallConfigPayload>;
    const rules = (parsed as Partial<FirewallConfigPayload>).rules
      ? await getFirewallRules()
      : {
          HOME: (parsed as Partial<FirewallRules>).HOME ?? defaultFirewallRules.HOME,
          FORM_EDITOR: (parsed as Partial<FirewallRules>).FORM_EDITOR ?? defaultFirewallRules.FORM_EDITOR,
          FORM_DASHBOARD: (parsed as Partial<FirewallRules>).FORM_DASHBOARD ?? defaultFirewallRules.FORM_DASHBOARD,
        };
    const ipPool = Array.isArray((parsed as Partial<FirewallConfigPayload>).ipPool)
      ? ((parsed as Partial<FirewallConfigPayload>).ipPool ?? []).map(normalizeIp).filter(Boolean)
      : Array.from(new Set(Object.values(rules).flatMap((x) => x.ips.map(normalizeIp)).filter(Boolean)));
    return { rules, ipPool: Array.from(new Set([...IMMUTABLE_ALLOW_IPS.map(normalizeIp), ...ipPool])) };
  } catch {
    return { rules: defaultFirewallRules, ipPool: [...IMMUTABLE_ALLOW_IPS] };
  }
}
async function canAccessPage(req: express.Request, page: FirewallPageKey): Promise<boolean> {
  const rules = await getFirewallRules();
  const rule = rules[page];
  if (!rule?.enabled) return true;
  return ipAllowed(readClientIp(req), rule.ips ?? []);
}
async function denyIfBlocked(req: express.Request, res: express.Response, page: FirewallPageKey): Promise<boolean> {
  const ok = await canAccessPage(req, page);
  if (ok) return false;
  res.status(403).json({ error: `Bu sayfaya IP izni yok (${readClientIp(req)})` });
  return true;
}

const optionSchema = z.object({ id: z.string(), label: z.string(), parentOptionIds: z.array(z.string()).optional(), score: z.number().optional() });
const rowSchema = z.object({ id: z.string(), label: z.string() });
const showWhenSchema = z.object({ questionId: z.string(), optionIds: z.array(z.string()) }).nullable().optional();
const flowMissingQuotaConditionSchema = z.object({
  kind: z.literal("MISSING_ENTITY_QUOTA"),
  questionId: z.string(),
  periodUnit: z.enum(["DAY", "MONTH", "YEAR"]),
  periodValue: z.number().int().min(1),
  minCount: z.number().int().min(1),
  entities: z.array(z.string()).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  reportTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
const flowAnswerLabelMatchConditionSchema = z.object({
  kind: z.literal("ANSWER_LABEL_MATCH"),
  questionIds: z.array(z.string()).min(1),
  expectedLabel: z.string().min(1),
  mode: z.enum(["ANY", "ALL"]).default("ANY"),
});
const flowConditionSchema = z.discriminatedUnion("kind", [
  flowMissingQuotaConditionSchema,
  flowAnswerLabelMatchConditionSchema,
]);
const flowActionSchema = z.object({
  kind: z.literal("SEND_EMAIL"),
  emails: z.array(z.string().url()).min(1),
  subject: z.string().optional(),
  messageTemplate: z.string().optional(),
});
const flowRuleInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  trigger: z.enum(["ON_SCHEDULE", "ON_SUBMIT"]).optional(),
  condition: flowConditionSchema,
  action: flowActionSchema,
});
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

function normalizeText(v: string): string {
  return v.trim().toLocaleLowerCase("tr");
}

function renderTemplate(template: string | undefined, tags: Record<string, string>, fallback: string): string {
  if (!template || !template.trim()) return fallback;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => tags[key] ?? `{${key}}`);
}

function extractSelectedLabels(
  q: { optionsJson: string },
  rawAnswer: unknown
): string[] {
  const options = JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string }>;
  const labelById = new Map(options.map((o) => [o.id, o.label]));
  const out: string[] = [];
  if (typeof rawAnswer === "string") {
    out.push(labelById.get(rawAnswer) ?? rawAnswer);
  } else if (Array.isArray(rawAnswer)) {
    for (const x of rawAnswer) {
      if (typeof x === "string") out.push(labelById.get(x) ?? x);
    }
  }
  return out;
}

function formatAnswerForReport(
  q: { id: string; title: string; type: string; optionsJson: string; rowsJson?: string | null },
  rawAnswer: unknown
): string {
  const options = JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string }>;
  const optionLabel = new Map(options.map((o) => [o.id, o.label || o.id]));
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === "") return "(bos)";
  if (typeof rawAnswer === "string") return optionLabel.get(rawAnswer) ?? rawAnswer;
  if (typeof rawAnswer === "number" || typeof rawAnswer === "boolean") return String(rawAnswer);
  if (Array.isArray(rawAnswer)) {
    const arr = rawAnswer.map((x) => (typeof x === "string" ? (optionLabel.get(x) ?? x) : String(x)));
    return arr.join(", ");
  }
  if (q.type === "GRID" && typeof rawAnswer === "object") {
    const rows = JSON.parse(q.rowsJson || "[]") as Array<{ id: string; label: string }>;
    const rowMap = rawAnswer as Record<string, unknown>;
    return rows
      .map((r) => `${r.label}: ${optionLabel.get(String(rowMap[r.id])) ?? String(rowMap[r.id] ?? "(bos)")}`)
      .join(" | ");
  }
  try {
    return JSON.stringify(rawAnswer);
  } catch {
    return String(rawAnswer);
  }
}

function formatQuestionDetailForNonconformity(params: {
  q: { id: string; title: string; type: string; optionsJson: string; rowsJson?: string | null };
  rawAnswer: unknown;
  isWatched: boolean;
  expectedLabelNorm: string;
}): string {
  const q = params.q;
  const raw = params.rawAnswer;
  if (raw === undefined || raw === null || raw === "") return "(bos)";

  const options = JSON.parse(q.optionsJson || "[]") as Array<{ id: string; label: string }>;
  const labelById = new Map(options.map((o) => [o.id, o.label || o.id]));

  if (q.type === "SINGLE_CHOICE" || q.type === "MULTI_CHOICE") {
    const selected = new Set<string>();
    if (typeof raw === "string") selected.add(raw);
    if (Array.isArray(raw)) for (const x of raw) if (typeof x === "string") selected.add(x);
    const parts = options.map((opt) => {
      const isSel = selected.has(opt.id);
      const norm = normalizeText(opt.label || "");
      const isBad = params.isWatched && isSel && norm === params.expectedLabelNorm;
      const mark = isBad ? "🔴" : isSel ? "🟢" : "⚪";
      return `${mark} ${opt.label || opt.id}`;
    });
    return parts.join(" | ");
  }

  if (q.type === "GRID" && typeof raw === "object" && raw !== null) {
    const rows = JSON.parse(q.rowsJson || "[]") as Array<{ id: string; label: string }>;
    const rowMap = raw as Record<string, unknown>;
    return rows
      .map((r) => {
        const cell = rowMap[r.id];
        const txt = typeof cell === "string" ? (labelById.get(cell) ?? cell) : String(cell ?? "(bos)");
        return `${r.label}: ${txt}`;
      })
      .join(" | ");
  }

  return formatAnswerForReport(q, raw);
}

async function runSubmitFlowRules(params: {
  form: { id: string; title: string; questions: Array<{ id: string; title: string; type: string; optionsJson: string; rowsJson: string | null }> };
  answers: Record<string, unknown>;
  submissionId: string;
}) {
  const rules = await prisma.formFlowRule.findMany({
    where: { formId: params.form.id, enabled: true, trigger: "ON_SUBMIT" },
    orderBy: { createdAt: "asc" },
  });
  if (!rules.length) return;

  const questionById = new Map(params.form.questions.map((q) => [q.id, q]));
  for (const rule of rules) {
    let condition: z.infer<typeof flowConditionSchema> | null = null;
    let action: z.infer<typeof flowActionSchema> | null = null;
    try {
      condition = flowConditionSchema.parse(JSON.parse(rule.conditionJson));
      action = flowActionSchema.parse(JSON.parse(rule.actionJson));
    } catch {
      continue;
    }
    if (!action.emails.length) continue;
    if (condition.kind !== "ANSWER_LABEL_MATCH") continue;

    const expected = normalizeText(condition.expectedLabel);
    const checks = condition.questionIds.map((qid) => {
      const q = questionById.get(qid);
      if (!q) return false;
      const labels = extractSelectedLabels(q, params.answers[qid]);
      return labels.some((label) => normalizeText(label) === expected);
    });
    if (!checks.length) continue;

    const matched = condition.mode === "ALL" ? checks.every(Boolean) : checks.some(Boolean);
    if (!matched) continue;

    const subject = action.subject?.trim() || "Uygunsuzluk Girişi Yapılmıştır";
    const reportLines = params.form.questions
      .filter((q) => q.type !== "PAGE_BREAK")
      .map((q) => {
        const isWatched = condition.questionIds.includes(q.id);
        const detail = formatQuestionDetailForNonconformity({
          q,
          rawAnswer: params.answers[q.id],
          isWatched,
          expectedLabelNorm: expected,
        });
        return `| ${q.title || q.id} | ${detail} |`;
      });
    const defaultBody =
      `Form: ${params.form.title}\n` +
      `Kural: ${rule.name}\n` +
      `Gonderim ID: ${params.submissionId}\n` +
      `Tetikleyen kosul: ${condition.mode === "ALL" ? "Tum secili sorularda" : "Secili sorulardan en az birinde"} "${condition.expectedLabel}" secildi.\n\n` +
      `Tum cevaplar:\n` +
      `| Soru | Cevaplar |\n` +
      `|---|---|\n` +
      `${reportLines.join("\n")}`;
    const body = renderTemplate(action.messageTemplate, {
      formTitle: params.form.title,
      ruleName: rule.name,
      submissionId: params.submissionId,
      expectedLabel: condition.expectedLabel,
      mode: condition.mode === "ALL" ? "ALL" : "ANY",
    }, defaultBody);
    await notify(action.emails, subject, body);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/status", async (_req, res) => {
  res.json({ canRegister: false });
});

app.post("/api/auth/register", async (req, res) => {
  void req;
  return res.status(404).json({ error: "Kayıt sayfasi kapatildi." });
});

app.post("/api/auth/login", async (req, res) => {
  const body = z.object({ email: z.string().min(1), password: z.string(), otp: z.string().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Geçersiz veri" });
  const admin = await prisma.admin.findUnique({ where: { email: body.data.email.toLowerCase() } });
  if (!admin || !(await verifyPassword(body.data.password, admin.passwordHash))) {
    return res.status(401).json({ error: "Kullanici veya sifre hatali" });
  }
  if (admin.totpEnabled) {
    const otp = (body.data.otp ?? "").replace(/\s+/g, "");
    if (!otp) return res.status(401).json({ error: "2FA gerekli", requiresTotp: true });
    if (!admin.totpSecret) return res.status(401).json({ error: "2FA ayari bozuk", requiresTotp: true });
    const ok = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: "base32",
      token: otp,
      window: 1,
    });
    if (!ok) return res.status(401).json({ error: "2FA kodu hatali", requiresTotp: true });
  }
  res.json({ token: signToken(admin.id, admin.email, admin.role), email: admin.email, role: admin.role });
});

app.get("/api/admin/users", authMiddleware, requireAdminRole, async (_req, res) => {
  const admins = await prisma.admin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, createdAt: true, role: true, totpEnabled: true },
  });
  res.json(admins);
});

app.post("/api/admin/users", authMiddleware, requireAdminRole, async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(6), role: z.enum(["ADMIN", "USER"]).optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Gecersiz veri" });
  const email = body.data.email.toLowerCase();
  const exists = await prisma.admin.findUnique({ where: { email } });
  if (exists) return res.status(400).json({ error: "Bu e-posta zaten kayitli" });
  const created = await prisma.admin.create({
    data: { email, passwordHash: await hashPassword(body.data.password), role: body.data.role ?? "USER" },
  });
  res.status(201).json({ id: created.id, email: created.email, role: created.role });
});

app.put("/api/admin/users/:id/password", authMiddleware, requireAdminRole, async (req, res) => {
  const body = z.object({ password: z.string().min(6) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Gecersiz veri" });
  try {
    await prisma.admin.update({ where: { id: req.params.id }, data: { passwordHash: await hashPassword(body.data.password) } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Kullanici bulunamadi" });
  }
});

app.post("/api/admin/users/:id/2fa/setup", authMiddleware, requireAdminRole, async (req, res) => {
  const row = await prisma.admin.findUnique({ where: { id: req.params.id }, select: { email: true } });
  if (!row) return res.status(404).json({ error: "Kullanici bulunamadi" });
  const secret = speakeasy.generateSecret({ length: 20 });
  const label = `KYK Form:${row.email}`;
  const otpauthUrl =
    speakeasy.otpauthURL({
      secret: secret.ascii,
      label,
      issuer: "KYK Form",
      encoding: "ascii",
    }) || "";
  await prisma.admin.update({ where: { id: req.params.id }, data: { totpEnabled: false, totpSecret: secret.base32 } });
  let qrDataUrl = "";
  try {
    if (otpauthUrl) qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  } catch {
    qrDataUrl = "";
  }
  res.json({ otpauthUrl, qrDataUrl });
});

app.post("/api/admin/users/:id/2fa/enable", authMiddleware, requireAdminRole, async (req, res) => {
  const body = z.object({ otp: z.string().min(4) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Gecersiz veri" });
  const row = await prisma.admin.findUnique({ where: { id: req.params.id }, select: { totpSecret: true } });
  if (!row?.totpSecret) return res.status(400).json({ error: "Önce 2FA kurulumunu başlatın" });
  const otp = body.data.otp.replace(/\s+/g, "");
  const ok = speakeasy.totp.verify({ secret: row.totpSecret, encoding: "base32", token: otp, window: 1 });
  if (!ok) return res.status(400).json({ error: "Kod hatali" });
  await prisma.admin.update({ where: { id: req.params.id }, data: { totpEnabled: true } });
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/2fa/disable", authMiddleware, requireAdminRole, async (req, res) => {
  void req;
  try {
    await prisma.admin.update({ where: { id: req.params.id }, data: { totpEnabled: false, totpSecret: null } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Kullanici bulunamadi" });
  }
});

app.delete("/api/admin/users/:id", authMiddleware, requireAdminRole, async (req, res) => {
  const me = (req as express.Request & { adminId?: string }).adminId!;
  if (req.params.id === me) return res.status(400).json({ error: "Kendi kullanicinizi silemezsiniz" });
  const total = await prisma.admin.count();
  if (total <= 1) return res.status(400).json({ error: "Son yonetici silinemez" });
  try {
    await prisma.admin.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Kullanici bulunamadi" });
  }
});

app.get("/api/firewall", authMiddleware, requireAdminRole, async (_req, res) => {
  res.json(await getFirewallConfig());
});

app.put("/api/firewall", authMiddleware, requireAdminRole, async (req, res) => {
  const rulesSchema = z.object({
    HOME: z.object({ enabled: z.boolean(), ips: z.array(z.string()) }),
    FORM_EDITOR: z.object({ enabled: z.boolean(), ips: z.array(z.string()) }),
    FORM_DASHBOARD: z.object({ enabled: z.boolean(), ips: z.array(z.string()) }),
  });
  const firewallSchema = z.union([
    rulesSchema,
    z.object({ rules: rulesSchema, ipPool: z.array(z.string()).optional() }),
  ]);
  const parsed = firewallSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Gecersiz firewall ayari" });
  const rulesInput = ("rules" in parsed.data ? parsed.data.rules : parsed.data);
  const cleanedRules = Object.fromEntries(
    Object.entries(rulesInput).map(([k, v]) => [k, { enabled: v.enabled, ips: v.ips.map(normalizeIp).filter(Boolean) }])
  ) as FirewallRules;
  const ipPoolInput = ("rules" in parsed.data ? parsed.data.ipPool ?? [] : []);
  const cleanedPool = Array.from(
    new Set([
      ...IMMUTABLE_ALLOW_IPS.map(normalizeIp),
      ...ipPoolInput.map(normalizeIp).filter(Boolean),
      ...Object.values(cleanedRules).flatMap((v) => v.ips.map(normalizeIp)),
    ])
  );
  await prisma.firewallConfig.upsert({
    where: { id: "main" },
    update: { rulesJson: JSON.stringify({ rules: cleanedRules, ipPool: cleanedPool }) },
    create: { id: "main", rulesJson: JSON.stringify({ rules: cleanedRules, ipPool: cleanedPool }) },
  });
  res.json({ rules: cleanedRules, ipPool: cleanedPool });
});

app.get("/api/forms", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "HOME")) return;
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

app.post("/api/forms", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "HOME")) return;
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
  periodUnit: string; periodValue: number; expectedSubmissions: number; invalidAlertEnabled: boolean; slaHours: number | null; notifyEmails: string; notifyAt: string;
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
    notifyAt: form.notifyAt || "09:00",
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

app.get("/api/forms/:id", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "FORM_EDITOR")) return;
  const form = await prisma.form.findUnique({ where: { id: req.params.id }, include: { questions: { orderBy: { orderIndex: "asc" } } } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });
  res.json(serializeForm(form));
});

app.patch("/api/forms/:id", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "FORM_EDITOR")) return;
  const body = z.object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    published: z.boolean().optional(),
    slaHours: z.number().int().positive().nullable().optional(),
    notifyEmails: z.array(z.string().url()).optional(),
    notifyAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
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
  if (body.data.notifyAt !== undefined) data.notifyAt = body.data.notifyAt;
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

app.get("/api/forms/:id/flows", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "FORM_EDITOR")) return;
  const form = await prisma.form.findUnique({ where: { id: req.params.id } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });
  const rules = await prisma.formFlowRule.findMany({ where: { formId: req.params.id }, orderBy: { createdAt: "asc" } });
  res.json(
    rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      trigger: r.trigger,
      condition: JSON.parse(r.conditionJson),
      action: JSON.parse(r.actionJson),
      lastFiredAt: r.lastFiredAt,
    }))
  );
});

app.put("/api/forms/:id/flows", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "FORM_EDITOR")) return;
  const parsed = z.array(flowRuleInputSchema).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Geçersiz akış listesi" });
  const formId = req.params.id;
  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });

  const existing = await prisma.formFlowRule.findMany({ where: { formId }, select: { id: true } });
  const existingSet = new Set(existing.map((x) => x.id));
  const kept: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const rule of parsed.data) {
      const common = {
        name: rule.name,
        enabled: rule.enabled ?? true,
        trigger: rule.trigger ?? "ON_SCHEDULE",
        conditionJson: JSON.stringify(rule.condition),
        actionJson: JSON.stringify(rule.action),
      };
      if (rule.id && existingSet.has(rule.id)) {
        await tx.formFlowRule.update({ where: { id: rule.id }, data: common });
        kept.push(rule.id);
      } else {
        const created = await tx.formFlowRule.create({ data: { formId, ...common } });
        kept.push(created.id);
      }
    }
    if (kept.length === 0) await tx.formFlowRule.deleteMany({ where: { formId } });
    else await tx.formFlowRule.deleteMany({ where: { formId, id: { notIn: kept } } });
  });

  const rules = await prisma.formFlowRule.findMany({ where: { formId }, orderBy: { createdAt: "asc" } });
  res.json(
    rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      trigger: r.trigger,
      condition: JSON.parse(r.conditionJson),
      action: JSON.parse(r.actionJson),
      lastFiredAt: r.lastFiredAt,
    }))
  );
});

app.post("/api/notify/test", authMiddleware, requireAuth, async (req, res) => {
  const body = z.object({
    urls: z.array(z.string().url()).min(1),
    subject: z.string().optional(),
    message: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Gecersiz test bildirimi" });
  const subject = body.data.subject?.trim() || "KYK Form Test Bildirimi";
  const message = body.data.message?.trim() || `Bu bir test bildirimi.\nSaat: ${new Date().toISOString()}`;
  await notify(body.data.urls, subject, message);
  res.json({ ok: true, count: body.data.urls.length });
});

app.put("/api/forms/:id/questions", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "FORM_EDITOR")) return;
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

app.delete("/api/forms/:id", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "HOME")) return;
  try {
    await prisma.form.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Bulunamadı" });
  }
});

app.get("/api/forms/:id/qr", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "HOME")) return;
  const form = await prisma.form.findUnique({ where: { id: req.params.id } });
  if (!form) return res.status(404).json({ error: "Bulunamadı" });
  const url = `${publicBase.replace(/\/$/, "")}/f/${form.slug}`;
  const fmt = req.query.format === "png" ? "png" : "svg";
  if (fmt === "png") res.type("png").send(await QRCode.toBuffer(url, { type: "png", width: 320, margin: 2 }));
  else res.type("svg").send(await QRCode.toString(url, { type: "svg" }));
});

app.get("/api/forms/:id/stats", authMiddleware, requireAuth, async (req, res) => {
  if (await denyIfBlocked(req, res, "FORM_DASHBOARD")) return;
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
  if (!form.published) {
    const allowHome = await canAccessPage(req, "HOME");
    if (!allowHome) return res.status(403).json({ error: "Form yayinda degil; bu IP ile erisim yok" });
  }
  res.json(serializeForm(form));
});

app.post("/api/public/forms/:slug/session", async (req, res) => {
  const body = z.object({ sessionKey: z.string().min(8).max(200) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "sessionKey gerekli" });
  const form = await prisma.form.findFirst({ where: { slug: req.params.slug } });
  if (!form) return res.status(404).json({ error: "Form bulunamadı" });
  if (!form.published) {
    const allowHome = await canAccessPage(req, "HOME");
    if (!allowHome) return res.status(403).json({ error: "Form yayinda degil; bu IP ile erisim yok" });
  }
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
  if (!form.published) {
    const allowHome = await canAccessPage(req, "HOME");
    if (!allowHome) return res.status(403).json({ error: "Form yayinda degil; bu IP ile erisim yok" });
  }

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

  if (invalidReasons.length > 0) {
    return res.status(400).json({
      error: "Zorunlu sorular doldurulmadan form gonderilemez.",
      invalidReasons,
    });
  }

  const submission = await prisma.submission.create({ data: { formId: form.id, answersJson: JSON.stringify(answers) } });
  await prisma.formSession.updateMany({ where: { formId: form.id, sessionKey: body.data.sessionKey }, data: { submittedAt: new Date() } });

  await runSubmitFlowRules({ form, answers, submissionId: submission.id });

  res.status(201).json({ ok: true, submissionId: submission.id, invalid: invalidReasons.length > 0 });
});

const port = Number(process.env.PORT ?? "4000");
async function ensureDefaultAdmin() {
  const count = await prisma.admin.count();
  if (count > 0) return;
  await prisma.admin.create({
    data: {
      email: "admin",
      passwordHash: await hashPassword("admin123"),
      role: "ADMIN",
    },
  });
  console.log("Varsayilan admin olusturuldu: admin / admin123");
}
async function start() {
  await ensureDefaultAdmin();
  app.listen(port, () => console.log(`API http://0.0.0.0:${port}`));
  setInterval(() => runSlaCheckOnce().catch((e) => console.error("SLA check", e)), 60_000);
  runSlaCheckOnce().catch((e) => console.error("SLA check", e));
}
start().catch((e) => {
  console.error("Startup error", e);
  process.exit(1);
});
