type TeamsWebhookPayload = {
  text: string;
};

const DEFAULT_TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? "";

export async function sendTeams(webhookUrl: string, text: string) {
  if (!webhookUrl) return;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text } satisfies TeamsWebhookPayload),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`Teams webhook hata: ${res.status} ${res.statusText}${raw ? ` | ${raw}` : ""}`);
  }
}

export async function notify(webhookUrls: string[], subject: string, body: string) {
  const text = `**${subject}**\n\n${body}`.replace(/\n/g, "\n");
  const targets = Array.from(
    new Set((webhookUrls ?? []).map((x) => x.trim()).filter(Boolean))
  );
  if (targets.length === 0 && DEFAULT_TEAMS_WEBHOOK_URL) targets.push(DEFAULT_TEAMS_WEBHOOK_URL);
  if (targets.length === 0) return;
  await Promise.all(targets.map((url) => sendTeams(url, text)));
}

