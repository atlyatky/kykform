const base = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";

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
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function publicFormUrl(slug: string) {
  return `${window.location.origin}/f/${slug}`;
}
