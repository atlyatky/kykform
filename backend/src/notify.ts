/**
 * Teams Incoming Webhook: Office 365 Connector MessageCard + markdown tablolar.
 * Kanalda çerçeveli tablo görünümü Adaptive Card Table’dan genelde daha tutarlıdır.
 * https://learn.microsoft.com/en-us/outlook/actionable-messages/message-card-reference
 */

import { formatDateTimeTr } from "./datetime-tr.js";

const DEFAULT_TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? "";

const MAX_CELL_CHARS = 800;
const MAX_PLAIN_BODY_CHARS = 12_000;
const MAX_TABLE_ROWS = 40;

/** `true` ise Adaptive Card gönderilir (Power Automate “Post card” senaryosu); varsayılan: MessageCard. */
const USE_ADAPTIVE = (process.env.TEAMS_WEBHOOK_USE_ADAPTIVE ?? "").toLowerCase() === "true";

export type TeamsTableSection = {
  title?: string;
  columns: string[];
  rows: string[][];
};

export type TeamsReportPayload = {
  sections: TeamsTableSection[];
  footnote?: string;
};

type MessageCardPayload = {
  "@type": "MessageCard";
  "@context": "http://schema.org/extensions";
  summary: string;
  themeColor: string;
  title: string;
  sections: Array<{ markdown: boolean; text: string }>;
};

function safeCell(s: string): string {
  const t = String(s ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length <= MAX_CELL_CHARS) return t;
  return `${t.slice(0, MAX_CELL_CHARS)}…`;
}

/** Markdown tablo hücresinde | ve satır sonlarını güvenli hale getirir. */
function escapeMdCell(s: string): string {
  return safeCell(s)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function truncatePlain(s: string): string {
  const t = String(s ?? "").replace(/\r\n/g, "\n");
  if (t.length <= MAX_PLAIN_BODY_CHARS) return t;
  return `${t.slice(0, MAX_PLAIN_BODY_CHARS)}\n\n_(Kısaltıldı.)_`;
}

/** Rapor yapısını ekrandaki gibi markdown tablolara çevirir (Özet + Formun dolu görünümü). */
export function reportPayloadToMarkdown(p: TeamsReportPayload): string {
  const parts: string[] = [];
  for (const sec of p.sections) {
    if (sec.title) parts.push(`### ${sec.title}`, "");
    if (!sec.columns.length) continue;
    const header = `| ${sec.columns.map(escapeMdCell).join(" | ")} |`;
    const sep = `| ${sec.columns.map(() => "---").join(" | ")} |`;
    parts.push(header, sep);
    const rows = sec.rows.slice(0, MAX_TABLE_ROWS);
    for (const row of rows) {
      const line = sec.columns.map((_, i) => escapeMdCell(String(row[i] ?? ""))).join(" | ");
      parts.push(`| ${line} |`);
    }
    parts.push("");
  }
  if (p.footnote) parts.push(p.footnote, "");
  parts.push(`*Rapor zamanı: ${formatDateTimeTr(new Date())} (Türkiye saati)*`);
  return parts.join("\n");
}

function buildMessageCard(subject: string, markdownBody: string): MessageCardPayload {
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: subject.slice(0, 200),
    themeColor: "C0504D",
    title: subject,
    sections: [{ markdown: true, text: markdownBody }],
  };
}

/* ---------- İsteğe bağlı: Adaptive Card (TEAMS_WEBHOOK_USE_ADAPTIVE=true) ---------- */

function textBlock(text: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "TextBlock", text: safeCell(text), wrap: true, ...opts };
}

function tableElement(columns: string[], rows: string[][]): Record<string, unknown> {
  const colWidths = columns.map(() => ({ width: 1 }));
  const tableRows: Record<string, unknown>[] = [];
  if (columns.length > 0) {
    tableRows.push({
      type: "TableRow",
      style: "accent",
      cells: columns.map((c) => ({
        type: "TableCell",
        items: [textBlock(c, { weight: "Bolder", size: "Small" })],
      })),
    });
  }
  for (const row of rows.slice(0, MAX_TABLE_ROWS)) {
    const cells = columns.map((_, i) => ({
      type: "TableCell",
      items: [textBlock(String(row[i] ?? ""), { size: "Small" })],
    }));
    tableRows.push({ type: "TableRow", cells });
  }
  return {
    type: "Table",
    columns: colWidths,
    rows: tableRows,
    showGridLines: true,
    gridStyle: "accent",
    spacing: "Small",
  };
}

function buildAdaptiveReportBody(_subject: string, payload: TeamsReportPayload): Array<Record<string, unknown>> {
  const body: Array<Record<string, unknown>> = [
    textBlock(`Rapor zamanı: ${formatDateTimeTr(new Date())} (Türkiye saati)`, {
      isSubtle: true,
      size: "Small",
      spacing: "None",
    }),
  ];
  for (const sec of payload.sections) {
    if (sec.title) body.push(textBlock(sec.title, { weight: "Bolder", size: "Medium", spacing: "Medium" }));
    if (!sec.columns.length) continue;
    const rows = sec.rows.map((r) => r.map((c) => safeCell(String(c))));
    body.push(tableElement(sec.columns, rows));
  }
  if (payload.footnote) body.push(textBlock(payload.footnote, { isSubtle: true, spacing: "Medium", size: "Small" }));
  return body;
}

function buildAdaptivePlain(subject: string, bodyText: string): Array<Record<string, unknown>> {
  return [
    textBlock(subject, { weight: "Bolder", size: "Large" }),
    textBlock(truncatePlain(bodyText), { spacing: "Small", wrap: true }),
    textBlock(`Gönderim: ${formatDateTimeTr(new Date())} (Türkiye saati)`, { isSubtle: true, size: "Small" }),
  ];
}

function buildTeamsAdaptiveMessage(subject: string, body: string | TeamsReportPayload) {
  const cardBody =
    typeof body === "string" ? buildAdaptivePlain(subject, body) : buildAdaptiveReportBody(subject, body);
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.5",
          msteams: { width: "Full" },
          body: cardBody,
        },
      },
    ],
  };
}

export async function sendTeams(webhookUrl: string, subject: string, body: string | TeamsReportPayload) {
  if (!webhookUrl) return;

  let payload: MessageCardPayload | ReturnType<typeof buildTeamsAdaptiveMessage>;

  if (USE_ADAPTIVE) {
    payload = buildTeamsAdaptiveMessage(subject, body);
  } else if (typeof body === "string") {
    const md =
      truncatePlain(body) +
      `\n\n*Gönderim: ${formatDateTimeTr(new Date())} (Türkiye saati)*`;
    payload = buildMessageCard(subject, md);
  } else {
    payload = buildMessageCard(subject, reportPayloadToMarkdown(body));
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    // Bildirim hatası uygulamayı düşürmemeli; sadece logla.
    console.error(`Teams webhook hata: ${res.status} ${res.statusText}${raw ? ` | ${raw}` : ""}`);
  }
}

export async function notify(webhookUrls: string[], subject: string, body: string | TeamsReportPayload) {
  const targets = Array.from(
    new Set((webhookUrls ?? []).map((x) => x.trim()).filter(Boolean))
  );
  if (targets.length === 0 && DEFAULT_TEAMS_WEBHOOK_URL) targets.push(DEFAULT_TEAMS_WEBHOOK_URL);
  if (targets.length === 0) return;
  await Promise.allSettled(targets.map((url) => sendTeams(url, subject, body)));
}
