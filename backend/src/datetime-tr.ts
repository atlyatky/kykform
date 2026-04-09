/** Türkiye saati (Docker/host TZ ile uyumlu; raporlarda tek tip gösterim). */
const TZ = "Europe/Istanbul";

export function formatDateTr(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, dateStyle: "short" }).format(d);
}

export function formatTimeTr(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, timeStyle: "medium" }).format(d);
}

export function formatDateTimeTr(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(d);
}
