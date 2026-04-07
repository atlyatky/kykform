type TeamsWebhookPayload = {
  text: string;
};

const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? "";

export async function sendTeams(text: string) {
  if (!TEAMS_WEBHOOK_URL) return;
  const res = await fetch(TEAMS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text } satisfies TeamsWebhookPayload),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`Teams webhook hata: ${res.status} ${res.statusText}${raw ? ` | ${raw}` : ""}`);
  }
}

export async function notify(subject: string, body: string) {
  // Tek kanal: Teams. İstenirse ileride mail de eklenebilir.
  const text = `**${subject}**\n\n${body}`.replace(/\n/g, "\n");
  await sendTeams(text);
}

