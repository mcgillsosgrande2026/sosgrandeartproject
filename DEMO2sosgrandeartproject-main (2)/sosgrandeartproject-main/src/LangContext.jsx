import { createContext, useContext, useState, useEffect } from "react";
import { UI } from "./i18n";

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem("sosg_lang");
      if (saved === "en" || saved === "es") return saved;
    } catch {
      // ignore
    }
    return "en";
  });

  useEffect(() => {
    try {
      localStorage.setItem("sosg_lang", lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const t = (key) => UI[lang]?.[key] ?? UI.en[key] ?? key;

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}

export function LangToggle({ dark = true }) {
  const { lang, setLang } = useLang();
  const active = dark ? "rgba(255,255,255,.14)" : "#e6f5f3";
  const inactive = "transparent";
  const activeColor = dark ? "#fff" : "#005f6b";
  const inactiveColor = dark ? "rgba(255,255,255,.55)" : "#617880";
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {["en", "es"].map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          style={{
            background: lang === l ? active : inactive,
            border: "none",
            color: lang === l ? activeColor : inactiveColor,
            borderRadius: 6,
            padding: "5px 9px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
