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

/** Anlık tarihin İstanbul takvim parçaları (yıl, ay, gün). */
export function getYmdInIstanbul(d: Date): { y: number; m: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "month")?.value ?? 0);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 0);
  return { y, m, day };
}

/**
 * Verilen İstanbul takvim gününün başlangıcı (00:00 Europe/Istanbul).
 * TR sürekli UTC+3 (yaz/kış saati yok); gün sınırı TR gece yarısıdır.
 */
export function startOfIstanbulCalendarDay(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, -3, 0, 0, 0));
}

const MS_PER_DAY = 86400000;

/**
 * SLA “doldurulmadı” raporu için dönem başlangıcı: UTC değil, İstanbul takvimine göre.
 * DAY: bugün 00:00 TR’dan geriye (periodValue-1) tam gün.
 */
export function slaPeriodStart(unit: "DAY" | "MONTH" | "YEAR", value: number, now: Date): Date {
  const v = Math.max(1, value);
  const { y, m, day } = getYmdInIstanbul(now);
  if (unit === "DAY") {
    const todayStart = startOfIstanbulCalendarDay(y, m, day);
    return new Date(todayStart.getTime() - (v - 1) * MS_PER_DAY);
  }
  if (unit === "MONTH") {
    let yy = y;
    let mm = m - (v - 1);
    while (mm < 1) {
      mm += 12;
      yy -= 1;
    }
    while (mm > 12) {
      mm -= 12;
      yy += 1;
    }
    return startOfIstanbulCalendarDay(yy, mm, 1);
  }
  return startOfIstanbulCalendarDay(y - (v - 1), 1, 1);
}
