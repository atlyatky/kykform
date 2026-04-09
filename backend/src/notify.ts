/**
 * Teams Incoming Webhook + Power Automate uyumu:
 * https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
 * Gövde kökünde "type": "AdaptiveCard" olmalı (bot/akış kart eylemleri bunu bekler).
 */

const DEFAULT_TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? "";

/** Teams kart gövdesi için güvenli üst sınır (çok uzun tablolarda hata önleme). */
const MAX_BODY_CHARS = 14_000;

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

function truncateBody(text: string): string {
  if (text.length <= MAX_BODY_CHARS) return text;
  return `${text.slice(0, MAX_BODY_CHARS)}\n\n_(Mesaj uzunluk sınırı nedeniyle kısaltıldı.)_`;
}

function buildTeamsAdaptiveMessage(subject: string, bodyText: string): TeamsIncomingWebhookMessage {
  const body = truncateBody(bodyText);
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body: [
            {
              type: "TextBlock",
              text: subject,
              weight: "Bolder",
              size: "Large",
              wrap: true,
            },
            {
              type: "TextBlock",
              text: body,
              wrap: true,
              fontType: "Monospace",
              spacing: "Medium",
            },
          ],
        },
      },
    ],
  };
}

export async function sendTeams(webhookUrl: string, subject: string, bodyText: string) {
  if (!webhookUrl) return;
  const payload = buildTeamsAdaptiveMessage(subject, bodyText);
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

export async function notify(webhookUrls: string[], subject: string, body: string) {
  const targets = Array.from(
    new Set((webhookUrls ?? []).map((x) => x.trim()).filter(Boolean))
  );
  if (targets.length === 0 && DEFAULT_TEAMS_WEBHOOK_URL) targets.push(DEFAULT_TEAMS_WEBHOOK_URL);
  if (targets.length === 0) return;
  await Promise.all(targets.map((url) => sendTeams(url, subject, body)));
}
