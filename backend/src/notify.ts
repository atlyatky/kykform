/**
 * Teams Incoming Webhook: message + Adaptive Card (tablo raporları).
 * https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
 */

import { formatDateTimeTr } from "./datetime-tr.js";

const DEFAULT_TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? "";

const MAX_CELL_CHARS = 500;
const MAX_PLAIN_BODY_CHARS = 12_000;
const MAX_TABLE_ROWS = 35;

export type TeamsTableSection = {
  title?: string;
  columns: string[];
  rows: string[][];
};

export type TeamsReportPayload = {
  sections: TeamsTableSection[];
  footnote?: string;
};

type TeamsAdaptiveAttachment = {
  contentType: "application/vnd.microsoft.card.adaptive";
  content: {
    $schema: string;
    type: "AdaptiveCard";
    version: string;
    msteams?: { width: "Full" };
    body: Array<Record<string, unknown>>;
  };
};

type TeamsIncomingWebhookMessage = {
  type: "message";
  attachments: TeamsAdaptiveAttachment[];
};

function safeCell(s: string): string {
  const t = String(s ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length <= MAX_CELL_CHARS) return t;
  return `${t.slice(0, MAX_CELL_CHARS)}…`;
}

function truncatePlain(s: string): string {
  const t = String(s ?? "").replace(/\r\n/g, "\n");
  if (t.length <= MAX_PLAIN_BODY_CHARS) return t;
  return `${t.slice(0, MAX_PLAIN_BODY_CHARS)}\n\n_(Kısaltıldı.)_`;
}

function textBlock(text: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "TextBlock", text: safeCell(text), wrap: true, ...opts };
}

/** Adaptive Card 1.5 Table — Teams kanal webhook’larında desteklenir. */
function tableElement(columns: string[], rows: string[][], headerStyle = true): Record<string, unknown> {
  const colWidths = columns.map(() => ({ width: 1 }));
  const tableRows: Record<string, unknown>[] = [];

  if (headerStyle && columns.length > 0) {
    tableRows.push({
      type: "TableRow",
      style: "accent",
      cells: columns.map((c) => ({
        type: "TableCell",
        items: [textBlock(c, { weight: "Bolder", size: "Small" })],
      })),
    });
  }

  const dataRows = rows.slice(0, MAX_TABLE_ROWS);
  for (const row of dataRows) {
    const cells = columns.map((_, i) => ({
      type: "TableCell",
      items: [textBlock(row[i] ?? "", { size: "Small" })],
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

function buildReportBody(subject: string, payload: TeamsReportPayload): Array<Record<string, unknown>> {
  const body: Array<Record<string, unknown>> = [
    textBlock(subject, { weight: "Bolder", size: "Large", spacing: "None" }),
    textBlock(`Rapor zamanı: ${formatDateTimeTr(new Date())} (Türkiye saati)`, {
      isSubtle: true,
      spacing: "Small",
      size: "Small",
    }),
  ];

  for (const sec of payload.sections) {
    if (sec.title) {
      body.push(textBlock(sec.title, { weight: "Bolder", size: "Medium", spacing: "Medium" }));
    }
    if (!sec.columns.length) continue;
    const rows = sec.rows.map((r) => r.map((c) => safeCell(String(c))));
    body.push(tableElement(sec.columns, rows, true));
  }

  if (payload.footnote) {
    body.push(textBlock(payload.footnote, { isSubtle: true, spacing: "Medium", size: "Small" }));
  }

  return body;
}

function buildPlainBody(subject: string, bodyText: string): Array<Record<string, unknown>> {
  return [
    textBlock(subject, { weight: "Bolder", size: "Large" }),
    textBlock(truncatePlain(bodyText), { wrap: true, spacing: "Small", fontType: "Monospace" }),
    textBlock(`Gönderim: ${formatDateTimeTr(new Date())} (Türkiye saati)`, {
      isSubtle: true,
      spacing: "Small",
      size: "Small",
    }),
  ];
}

function buildTeamsAdaptiveMessage(
  subject: string,
  body: string | TeamsReportPayload
): TeamsIncomingWebhookMessage {
  const cardBody =
    typeof body === "string" ? buildPlainBody(subject, body) : buildReportBody(subject, body);

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
  const payload = buildTeamsAdaptiveMessage(subject, body);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`Teams webhook hata: ${res.status} ${res.statusText}${raw ? ` | ${raw}` : ""}`);
  }
}

export async function notify(webhookUrls: string[], subject: string, body: string | TeamsReportPayload) {
  const targets = Array.from(
    new Set((webhookUrls ?? []).map((x) => x.trim()).filter(Boolean))
  );
  if (targets.length === 0 && DEFAULT_TEAMS_WEBHOOK_URL) targets.push(DEFAULT_TEAMS_WEBHOOK_URL);
  if (targets.length === 0) return;
  await Promise.all(targets.map((url) => sendTeams(url, subject, body)));
}
