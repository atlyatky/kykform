/** Boş = aynı origin (nginx /api proxy). Dolu = doğrudan API kökü (örn. http://host:4001) */
export const apiBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";
const base = apiBaseUrl;

export function getToken() {
  return localStorage.getItem("kyk_token");
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem("kyk_token", t);
  else localStorage.removeItem("kyk_token");
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (opts.auth !== false) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) {
    let msg = res.statusText || "İstek başarısız";
    const raw = await res.text();
    if (raw) {
      try {
        const j = JSON.parse(raw) as { error?: string };
        if (typeof j.error === "string" && j.error) msg = j.error;
      } catch {
        const t = raw.replace(/\s+/g, " ").trim();
        if (t.length > 0 && t.length < 400) msg = t;
      }
    }
    if (res.status === 403 && (msg === "Forbidden" || msg === "")) {
      msg =
        "Erişim reddedildi (403). Giriş yapın veya sunucuyu güncelleyin (git pull + docker compose up -d --build).";
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Dış paylaşım kökü (örn. https://form.sirket.com). Boş = mevcut site (window.location.origin). */
const publicBase =
  (import.meta.env.VITE_PUBLIC_FORM_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

export function publicFormUrl(slug: string) {
  const base = publicBase || window.location.origin;
  return `${base}/f/${slug}`;
}

/** HTTP veya izin kısıtında panoya yazmak için (clipboard API yoksa textarea fallback). */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
