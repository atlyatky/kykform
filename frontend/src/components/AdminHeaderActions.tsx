import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Settings2 } from "lucide-react";
import { isAdminToken, setToken } from "../api";

export function AdminHeaderActions() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function logout() {
    setToken(null);
    nav("/login");
    setOpen(false);
  }

  const menuItem = (to: string, label: string) => (
    <Link
      key={to}
      to={to}
      className="btn"
      style={{
        justifyContent: "flex-start",
        fontWeight: loc.pathname === to ? 600 : 400,
        background: loc.pathname === to ? "var(--surface2)" : "transparent",
      }}
      onClick={() => setOpen(false)}
    >
      {label}
    </Link>
  );

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={open}
          aria-haspopup="true"
          title="Ayarlar"
          onClick={() => setOpen((v) => !v)}
        >
          <Settings2 size={18} />
        </button>
        {open && (
          <div
            className="card"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 0.35rem)",
              minWidth: 200,
              padding: "0.35rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              zIndex: 50,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          >
            {menuItem("/", "Form listesi")}
            {isAdminToken() && menuItem("/users", "Kullanıcılar")}
            {isAdminToken() && menuItem("/firewall", "Firewall")}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-ghost" onClick={logout} title="Çıkış yap">
        <LogOut size={16} />
        <span>Çıkış yap</span>
      </button>
    </div>
  );
}
