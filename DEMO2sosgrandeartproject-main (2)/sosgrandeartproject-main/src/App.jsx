import { useState, useEffect, useRef } from "react";
import { sGet, sSet, uploadArtwork, downloadUrl, wipeTestData, deleteSubmission } from "./api";
import { DEFAULT_CONTENT, DEFAULT_STATUS, GRADE_OPTIONS, LOCALES } from "./i18n";
import { LangProvider, useLang, LangToggle } from "./LangContext";

// ─── Storage keys ──────────────────────────────────────────────────────────
const SUBS_KEY = "woc_submissions";
const CONTENT_KEY = "woc_content";
const REGS_KEY = "woc_registrations";
const STATUS_KEY = "woc_contest_status"; // { status: "open"|"not_open"|"closed", closedMessage: {en, es} }
const ADMIN_PASS = "sos!grande2027";
const SESSION_KEY = "sosg_student_session"; // browser-local, keeps a student's registration alive across refreshes on the same device

// ─── Small local helpers ──────────────────────────────────────────────────
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(reg) {
  try {
    if (reg) localStorage.setItem(SESSION_KEY, JSON.stringify(reg));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore — session just won't persist across refreshes
  }
}

// Turns an array of flat objects into a CSV string and triggers a download.
// Used by the admin dashboard so non-technical organizers can open
// submissions/registrations in Excel/Google Sheets without any code.
function downloadCSV(filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(([, label]) => esc(label)).join(",");
  const body = rows.map((row) => columns.map(([key]) => esc(row[key])).join(",")).join("\n");
  const csv = "\uFEFF" + header + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Colour tokens (ocean palette) ───────────────────────────────────────────
const C = {
  ink: "#0e2028",
  ocean: "#005f6b",
  deep: "#003d47",
  foam: "#3cb6a8",
  foamBg: "#e6f5f3",
  sand: "#f7f0e6",
  sandMid: "#e8ddd0",
  sandDark: "#c8bdb0",
  white: "#ffffff",
  coral: "#d95f3b",
  coralBg: "#faeae4",
  muted: "#617880",
  border: "#d0c9be",
};

// ─── Shared micro-components ──────────────────────────────────────────────────
const Badge = ({ children, color = C.foam }) => (
  <span
    style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      background: color === "coral" ? C.coralBg : C.foamBg,
      color: color === "coral" ? C.coral : C.ocean,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </span>
);

const Divider = () => <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "24px 0" }} />;

const Field = ({ label, hint, error, children }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {label}
      {hint && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.sandDark, marginLeft: 6 }}>{hint}</span>}
    </label>
    {children}
    {error && <div style={{ fontSize: 12, color: C.coral, marginTop: 4 }}>{error}</div>}
  </div>
);

const inputStyle = (err) => ({
  width: "100%",
  padding: "10px 13px",
  border: `1.5px solid ${err ? C.coral : C.border}`,
  borderRadius: 8,
  fontSize: 14,
  color: C.ink,
  background: C.white,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
});

const Btn = ({ children, onClick, variant = "primary", small, type = "button", disabled }) => {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderRadius: 8,
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all .15s",
    fontSize: small ? 12 : 14,
    padding: small ? "6px 12px" : "12px 22px",
    opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    primary: { background: C.deep, color: C.white },
    secondary: { background: C.foamBg, color: C.ocean, border: `1.5px solid ${C.foam}` },
    ghost: { background: "transparent", color: C.muted, border: `1.5px solid ${C.border}` },
    danger: { background: C.coralBg, color: C.coral, border: `1.5px solid ${C.coral}` },
    foam: { background: C.foam, color: C.white },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// STUDENT PORTAL
// ═════════════════════════════════════════════════════════════════════════════

function StudentPortal({ content, status }) {
  const [page, setPage] = useState("home"); // home | register | submit
  const [regData, setRegDataRaw] = useState(() => loadSession());
  const [statusPopup, setStatusPopup] = useState(false);
  const { lang } = useLang();

  // Keep the browser session in sync whenever regData changes, so a student
  // who registers and then closes the tab or refreshes the page doesn't
  // lose their spot and end up re-registering by accident.
  const setRegData = (reg) => {
    setRegDataRaw(reg);
    saveSession(reg);
  };

  const isOpen = (status?.status || "open") === "open";

  // Every entry point into the registration page routes through here, so
  // whichever status the admin has set is enforced no matter which button
  // the student clicked.
  const goToRegister = () => {
    if (!isOpen) {
      setStatusPopup(true);
      return;
    }
    setPage("register");
  };

  return (
    <div style={{ background: C.sand, minHeight: "100vh", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <StudentNav page={page} setPage={setPage} regData={regData} setRegData={setRegData} goToRegister={goToRegister} />
      {page === "home" && <StudentHome content={content} setPage={setPage} goToRegister={goToRegister} status={status} />}
      {page === "register" && <StudentRegister content={content} setPage={setPage} setRegData={setRegData} regData={regData} />}
      {page === "submit" && <StudentSubmit content={content} regData={regData} setRegData={setRegData} setPage={setPage} goToRegister={goToRegister} />}
      {statusPopup && (
        <StatusMessagePopup message={status?.closedMessage?.[lang] || DEFAULT_STATUS.closedMessage[lang]} onClose={() => setStatusPopup(false)} />
      )}
    </div>
  );
}

function StatusMessagePopup({ message, onClose }) {
  const { t } = useLang();
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(14,32,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.white, borderRadius: 14, padding: "26px 24px", maxWidth: 400, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,.2)" }}
      >
        <div style={{ fontSize: 28, marginBottom: 10 }}>📌</div>
        <h3 style={{ fontFamily: "Georgia,serif", fontSize: 19, color: C.deep, margin: "0 0 10px" }}>{t("status_popup_title")}</h3>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 22 }}>{message}</p>
        <Btn onClick={onClose} variant="foam">{t("status_popup_ok")}</Btn>
      </div>
    </div>
  );
}

function StudentNav({ page, setPage, regData, setRegData, goToRegister }) {
  const { t } = useLang();
  return (
    <nav style={{ background: C.deep, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 50, flexWrap: "wrap", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>🌊</span>
        <div>
          <div style={{ color: C.white, fontWeight: 700, fontSize: 14, lineHeight: 1 }}>SOS Grande</div>
          <div style={{ color: "rgba(255,255,255,.45)", fontSize: 11 }}>{t("nav_sub")}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {regData && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.08)", borderRadius: 20, padding: "4px 6px 4px 12px" }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>
              {t("nav_signedin_as")} <strong style={{ color: C.white }}>{regData.firstname}</strong>
            </span>
            <button
              onClick={() => {
                if (window.confirm(t("nav_startover_confirm"))) {
                  setRegData(null);
                  setPage("home");
                }
              }}
              style={{ background: "rgba(255,255,255,.12)", border: "none", color: "rgba(255,255,255,.7)", borderRadius: 14, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
            >
              {t("nav_startover")}
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            ["home", t("nav_contest")],
            ["register", t("nav_signup")],
            ["submit", t("nav_submit")],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => (k === "register" ? goToRegister() : setPage(k))}
              style={{
                background: page === k ? "rgba(255,255,255,.14)" : "transparent",
                border: "none",
                color: page === k ? C.white : "rgba(255,255,255,.55)",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <LangToggle dark />
      </div>
    </nav>
  );
}

function StudentHome({ content, setPage, goToRegister, status }) {
  const { t } = useLang();
  const statusKey = status?.status || "open";
  const badgeText = statusKey === "open" ? t("home_badge") : statusKey === "closed" ? t("home_badge_closed") : t("home_badge_not_open");
  const badgeColor = statusKey === "open" ? C.foam : "coral";
  const rules = (arr) =>
    arr.map((r, i) => (
      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.sandMid}` }}>
        <span style={{ color: C.foam, fontWeight: 700, flexShrink: 0 }}>✓</span>
        <span style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>{r}</span>
      </div>
    ));
  const noRules = (arr) =>
    arr.map((r, i) => (
      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.sandMid}` }}>
        <span style={{ color: C.coral, fontWeight: 700, flexShrink: 0 }}>✗</span>
        <span style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>{r}</span>
      </div>
    ));

  return (
    <div>
      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg, ${C.deep} 0%, ${C.ocean} 100%)`, padding: "52px 24px 60px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -40, top: -40, width: 260, height: 260, borderRadius: "50%", background: "rgba(60,182,168,.1)" }} />
        <div style={{ position: "absolute", right: 40, bottom: -60, width: 180, height: 180, borderRadius: "50%", background: "rgba(60,182,168,.07)" }} />
        <div style={{ maxWidth: 600, margin: "0 auto", position: "relative" }}>
          <Badge color={badgeColor}>{badgeText}</Badge>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 52, fontWeight: 400, color: C.white, margin: "14px 0 6px", lineHeight: 1.05 }}>{content.contestName}</h1>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,.65)", marginBottom: 6, fontStyle: "italic" }}>{content.tagline}</p>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,.55)", lineHeight: 1.75, maxWidth: 480, marginBottom: 32 }}>{content.heroBody}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={goToRegister} variant="foam">{t("home_cta_signup")}</Btn>
            <Btn onClick={() => document.getElementById("guidelines").scrollIntoView({ behavior: "smooth" })} variant="ghost">{t("home_cta_guidelines")}</Btn>
          </div>
        </div>
      </div>

      {/* Key dates bar */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-around", padding: "16px 24px", flexWrap: "wrap", gap: 16 }}>
          {[
            [content.deadlineLabel, content.deadlineDate],
            [content.announcementLabel, content.announcementDate],
            [t("datesbar_team_label"), t("datesbar_team_value")],
          ].map(([l, v], i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.deep }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Memo banner */}
      {content.memo && (
        <div style={{ background: "#fff9e6", borderBottom: "2px solid #f5c518", padding: "12px 24px" }}>
          <div style={{ maxWidth: 600, margin: "0 auto", fontSize: 14, color: "#7a5c00" }}>
            <strong>{t("memo_prefix")}</strong> {content.memo}
          </div>
        </div>
      )}

      <div id="guidelines" style={{ maxWidth: 600, margin: "0 auto", padding: "40px 24px 60px" }}>
        {/* Prize */}
        <div style={{ background: C.deep, borderRadius: 14, padding: "24px 22px", marginBottom: 24, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -20, top: -20, width: 120, height: 120, borderRadius: "50%", background: "rgba(60,182,168,.12)" }} />
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: C.foam, textTransform: "uppercase", marginBottom: 6 }}>{t("prize_label")}</div>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: C.white, marginBottom: 8 }}>{content.prizeTitle}</div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", lineHeight: 1.7 }}>{content.prizeBody}</p>
        </div>

        {/* Theme */}
        <SectionHead>{t("section_theme")}</SectionHead>
        <div style={{ background: C.white, borderRadius: 12, padding: "18px 20px", marginBottom: 20, border: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.75 }}>{content.theme}</p>
        </div>

        {/* Eligibility */}
        <SectionHead>{t("section_eligibility")}</SectionHead>
        <div style={{ background: C.white, borderRadius: 12, padding: "12px 20px", marginBottom: 20, border: `1px solid ${C.border}` }}>{rules(content.eligibility)}</div>

        {/* Artwork requirements */}
        <SectionHead>{t("section_artwork_reqs")}</SectionHead>
        <div style={{ background: C.white, borderRadius: 12, padding: "12px 20px", marginBottom: 12, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.foam, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 0 10px" }}>{t("artwork_must_label")}</div>
          {rules(content.artworkMust)}
          <div style={{ fontSize: 11, fontWeight: 700, color: C.coral, letterSpacing: "0.08em", textTransform: "uppercase", padding: "14px 0 10px" }}>{t("artwork_not_allowed")}</div>
          {noRules(content.artworkMustNot)}
        </div>

        {/* Statement guide */}
        <SectionHead>{t("section_statement")}</SectionHead>
        <div style={{ background: C.white, borderRadius: 12, padding: "16px 20px", marginBottom: 32, border: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.75 }}>{content.statementGuide}</p>
        </div>

        {/* CTA */}
        <div style={{ textAlign: "center" }}>
          <Btn onClick={goToRegister} variant="foam">{t("cta_final")}</Btn>
          <p style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
            {t("questions_label")} <a href={`mailto:${content.contactEmail}`} style={{ color: C.ocean }}>{content.contactEmail}</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div style={{ width: 3, height: 18, background: C.foam, borderRadius: 2 }} />
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.deep, margin: 0 }}>{children}</h2>
    </div>
  );
}

function StudentRegister({ content, setPage, setRegData, regData }) {
  const { t, lang } = useLang();
  const [form, setForm] = useState({ firstname: "", lastname: "", email: "", school: "", grade: "", teammates: "" });
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupErr, setLookupErr] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.firstname.trim()) e.firstname = t("error_required");
    if (!form.lastname.trim()) e.lastname = t("error_required");
    if (!form.email.includes("@")) e.email = t("error_email");
    if (!form.school.trim()) e.school = t("error_required");
    if (!form.grade) e.grade = t("error_grade");
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    const existing = (await sGet(REGS_KEY)) || [];
    // Avoid creating a duplicate registration if this email already signed
    // up (e.g. they registered earlier, cleared their browser data, and
    // filled out the form again by mistake) — reuse the existing record.
    const already = existing.find((r) => r.email.trim().toLowerCase() === form.email.trim().toLowerCase());
    if (already) {
      setRegData(already);
      setDone(true);
      return;
    }
    const reg = { id: "reg-" + Date.now(), ...form, registeredAt: new Date().toISOString(), hasSubmitted: false };
    await sSet(REGS_KEY, [...existing, reg]);
    setRegData(reg);
    setDone(true);
  };

  const lookup = async () => {
    setLookupErr("");
    if (!lookupEmail.includes("@")) {
      setLookupErr(t("error_email"));
      return;
    }
    setLookupBusy(true);
    const existing = (await sGet(REGS_KEY)) || [];
    setLookupBusy(false);
    const found = existing.find((r) => r.email.trim().toLowerCase() === lookupEmail.trim().toLowerCase());
    if (!found) {
      setLookupErr(t("lookup_not_found"));
      return;
    }
    setRegData(found);
    setPage("submit");
  };

  if (regData && !done)
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>👋</div>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, color: C.deep, marginBottom: 10 }}>
          {t("nav_signedin_as")} {regData.firstname}
        </h2>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>{t("reg_already_body")}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <Btn onClick={() => setPage("submit")} variant="foam">{t("btn_goto_submit")}</Btn>
          <Btn
            variant="ghost"
            onClick={() => {
              if (window.confirm(t("nav_startover_confirm"))) setRegData(null);
            }}
          >
            {t("nav_startover")}
          </Btn>
        </div>
      </div>
    );

  if (done)
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🌊</div>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, color: C.deep, marginBottom: 10 }}>{t("reg_success_title")}</h2>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 28 }}>
          {t("reg_success_welcome")} {content.contestName}, <strong>{form.firstname || regData?.firstname}</strong>. {t("reg_success_cansubmit")}
        </p>
        <Btn onClick={() => setPage("submit")} variant="foam">{t("btn_goto_submit")}</Btn>
      </div>
    );

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: "36px 24px 60px" }}>
      <h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, color: C.deep, marginBottom: 4 }}>{t("register_title")}</h1>
      <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>{t("register_subtitle")}</p>

      <div style={{ background: C.white, borderRadius: 14, padding: "24px 22px", border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>{t("your_info")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={t("label_firstname")} error={errors.firstname}>
            <input style={inputStyle(errors.firstname)} value={form.firstname} onChange={set("firstname")} placeholder="María" />
          </Field>
          <Field label={t("label_lastname")} error={errors.lastname}>
            <input style={inputStyle(errors.lastname)} value={form.lastname} onChange={set("lastname")} placeholder="González" />
          </Field>
        </div>
        <Field label={t("label_email")} error={errors.email}>
          <input style={inputStyle(errors.email)} type="email" value={form.email} onChange={set("email")} placeholder="student@school.cr" />
        </Field>
        <Field label={t("label_school")} error={errors.school}>
          <input style={inputStyle(errors.school)} value={form.school} onChange={set("school")} placeholder="Colegio Técnico Profesional de Santa Cruz" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={t("label_grade")} error={errors.grade}>
            <select style={inputStyle(errors.grade)} value={form.grade} onChange={set("grade")}>
              <option value="">{t("select_placeholder")}</option>
              {GRADE_OPTIONS[lang].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label={t("label_teammates")} hint={t("hint_optional")}>
            <input style={inputStyle(false)} value={form.teammates} onChange={set("teammates")} placeholder={t("placeholder_teammates")} />
          </Field>
        </div>
        <Btn onClick={submit} variant="foam" type="button">{t("btn_register")}</Btn>
      </div>

      <div style={{ marginTop: 18, background: C.foamBg, borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ocean, marginBottom: 8 }}>{t("lookup_title")}</div>
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>{t("lookup_body")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...inputStyle(lookupErr), flex: 1, minWidth: 180 }}
            type="email"
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            placeholder="student@school.cr"
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <Btn variant="secondary" small onClick={lookup} disabled={lookupBusy}>
            {lookupBusy ? "…" : t("lookup_btn")}
          </Btn>
        </div>
        {lookupErr && <div style={{ fontSize: 12, color: C.coral, marginTop: 6 }}>{lookupErr}</div>}
      </div>
    </div>
  );
}

function StudentSubmit({ content, regData, setRegData, setPage, goToRegister }) {
  const { t } = useLang();
  const [statement, setStatement] = useState("");
  const [file, setFile] = useState(null);
  const [consent1, setConsent1] = useState(false);
  const [consent2, setConsent2] = useState(false);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const wordCount = statement.trim() ? statement.trim().split(/\s+/).length : 0;
  const wcOk = wordCount >= 50 && wordCount <= 200;

  const validate = () => {
    const e = {};
    if (!regData) e.reg = t("error_reg_first");
    if (!wcOk) e.statement = `${t("error_statement_prefix")} ${wordCount}${t("error_statement_suffix")}`;
    if (!file) e.file = t("error_file");
    if (!consent1 || !consent2) e.consent = t("error_consent");
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setUploading(true);
    let artworkKey = null;
    try {
      artworkKey = await uploadArtwork(file);
    } catch {
      setUploading(false);
      setErrors({ file: t("error_upload_failed") });
      return;
    }
    setUploading(false);

    const sub = {
      id: "sub-" + Date.now(),
      regId: regData?.id,
      firstname: regData?.firstname,
      lastname: regData?.lastname,
      email: regData?.email,
      school: regData?.school,
      grade: regData?.grade,
      teammates: regData?.teammates,
      statement,
      filename: file.name,
      fileSize: (file.size / 1024 / 1024).toFixed(1) + "MB",
      artworkKey,
      status: "new",
      submittedAt: new Date().toISOString(),
    };
    const existing = (await sGet(SUBS_KEY)) || [];
    await sSet(SUBS_KEY, [...existing, sub]);
    // update registration
    if (regData) {
      const regs = (await sGet(REGS_KEY)) || [];
      await sSet(REGS_KEY, regs.map((r) => (r.id === regData.id ? { ...r, hasSubmitted: true } : r)));
      setRegData?.({ ...regData, hasSubmitted: true });
    }
    setDone(true);
  };

  if (!regData)
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⚠️</div>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, color: C.deep, marginBottom: 10 }}>{t("submit_needreg_title")}</h2>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>{t("submit_needreg_body")}</p>
        <Btn onClick={goToRegister} variant="foam">{t("btn_goto_register")}</Btn>
      </div>
    );

  if (regData.hasSubmitted && !done)
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, color: C.deep, marginBottom: 10 }}>{t("submit_already_title")}</h2>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 8 }}>
          {t("submit_success_thanks")} <strong>{regData.firstname}</strong>. {t("submit_already_body")}
        </p>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 28 }}>
          {t("submit_success_contact1")} <strong>{content.contactEmail}</strong>.
        </p>
        <Btn onClick={() => setPage("home")} variant="ghost">{t("btn_back_contest")}</Btn>
      </div>
    );

  if (done)
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎨</div>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, color: C.deep, marginBottom: 10 }}>{t("submit_success_title")}</h2>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 8 }}>
          {t("submit_success_thanks")} <strong>{regData.firstname}</strong>. {t("submit_success_inpart")}
        </p>
        <p style={{ color: C.muted, lineHeight: 1.7, marginBottom: 28 }}>
          {t("submit_success_contact1")} <strong>{regData.email}</strong>. {t("submit_success_goodluck")}
        </p>
        <Btn onClick={() => setPage("home")} variant="ghost">{t("btn_back_contest")}</Btn>
      </div>
    );

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "36px 24px 60px" }}>
      <h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, color: C.deep, marginBottom: 4 }}>{t("submit_title")}</h1>
      <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>
        {t("submit_subtitle_prefix")} <strong>{regData.firstname} {regData.lastname}</strong> — {regData.school}
      </p>

      {/* Statement */}
      <div style={{ background: C.white, borderRadius: 14, padding: "22px", border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>{t("statement_section")}</div>
        <Field label={t("label_your_statement")} hint={t("hint_words")} error={errors.statement}>
          <textarea
            style={{ ...inputStyle(errors.statement), minHeight: 140, lineHeight: 1.7, resize: "vertical" }}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder={content.statementGuide}
          />
          <div style={{ fontSize: 11, marginTop: 4, color: wcOk ? C.foam : wordCount > 200 ? C.coral : C.muted }}>
            {wordCount} {t("words_label")} {wcOk ? "✓" : wordCount > 200 ? t("words_toolong") : t("words_needmore")}
          </div>
        </Field>
      </div>

      {/* File upload */}
      <div style={{ background: C.white, borderRadius: 14, padding: "22px", border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>{t("artwork_file_section")}</div>
        {!file ? (
          <div
            onClick={() => fileRef.current.click()}
            style={{ border: `2px dashed ${errors.file ? C.coral : C.border}`, borderRadius: 10, padding: "32px 20px", textAlign: "center", cursor: "pointer", background: C.sand }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.deep, marginBottom: 4 }}>{t("upload_prompt")}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{t("upload_specs")}</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files[0]) setFile(e.target.files[0]);
                setErrors((p) => ({ ...p, file: null }));
              }}
            />
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.foamBg, borderRadius: 8, padding: "10px 14px" }}>
            <span>🖼️</span>
            <span style={{ fontSize: 13, color: C.ocean, fontWeight: 500, flex: 1 }}>
              {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </span>
            <button onClick={() => setFile(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
        )}
        {errors.file && <div style={{ fontSize: 12, color: C.coral, marginTop: 6 }}>{errors.file}</div>}
      </div>

      {/* Consent */}
      <div style={{ background: C.white, borderRadius: 14, padding: "22px", border: `1px solid ${errors.consent ? C.coral : C.border}`, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>{t("consent_section")}</div>
        {[
          [consent1, setConsent1, t("consent1_text")],
          [consent2, setConsent2, t("consent2_text")],
        ].map(([val, setter, text], i) => (
          <label key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", marginBottom: i === 0 ? 12 : 0 }}>
            <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} style={{ marginTop: 3, accentColor: C.foam, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{text}</span>
          </label>
        ))}
        {errors.consent && <div style={{ fontSize: 12, color: C.coral, marginTop: 8 }}>{errors.consent}</div>}
      </div>

      <Btn onClick={submit} variant="foam" type="button" disabled={uploading}>
        {uploading ? t("uploading_label") : t("btn_submit_artwork")}
      </Btn>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN LOGIN GATE
// ═════════════════════════════════════════════════════════════════════════════

function AdminGate({ contentAll, setContentAll, status, setStatus }) {
  const { t } = useLang();
  const [authed, setAuthed] = useState(false);
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(false);

  const login = () => {
    if (pass === ADMIN_PASS) {
      setErr(false);
      setAuthed(true);
    } else setErr(true);
  };

  if (!authed)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: C.sand, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "36px 32px", width: "100%", maxWidth: 360 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: C.foamBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🌊</div>
            <LangToggle dark={false} />
          </div>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 22, color: C.deep, marginBottom: 4 }}>{t("admin_gate_title")}</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>{t("admin_gate_subtitle")}</div>
          {err && <div style={{ background: C.coralBg, color: C.coral, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>{t("admin_gate_err")}</div>}
          <Field label={t("label_password")}>
            <input autoFocus style={inputStyle(false)} type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && login()} />
          </Field>
          <Btn onClick={login} variant="foam" type="button">{t("btn_signin")}</Btn>
        </div>
      </div>
    );

  return <AdminPanel contentAll={contentAll} setContentAll={setContentAll} status={status} setStatus={setStatus} onLogout={() => setAuthed(false)} />;
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL (Dashboard + Editor)
// ═════════════════════════════════════════════════════════════════════════════

function AdminPanel({ contentAll, setContentAll, status, setStatus, onLogout }) {
  const { t } = useLang();
  const [tab, setTab] = useState("submissions"); // submissions | registrations | editor | settings
  const [submissions, setSubmissions] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [selected, setSelected] = useState(null);

  const reload = () => {
    sGet(SUBS_KEY).then((d) => setSubmissions(d || []));
    sGet(REGS_KEY).then((d) => setRegistrations(d || []));
  };

  useEffect(() => {
    reload();
  }, [tab]);

  const updateStatus = async (id, status) => {
    const updated = submissions.map((s) => (s.id === id ? { ...s, status } : s));
    setSubmissions(updated);
    await sSet(SUBS_KEY, updated);
    if (selected?.id === id) setSelected((s) => ({ ...s, status }));
  };

  const TABS = [
    ["submissions", t("tab_submissions")],
    ["registrations", t("tab_registrations")],
    ["editor", t("tab_editor")],
    ["settings", t("tab_settings")],
  ];

  const statCounts = {
    total: submissions.length,
    new: submissions.filter((s) => s.status === "new").length,
    shortlisted: submissions.filter((s) => s.status === "shortlisted").length,
    schools: new Set(submissions.map((s) => s.school)).size,
    regs: registrations.length,
    submitted: registrations.filter((r) => r.hasSubmitted).length,
  };

  return (
    <div style={{ background: C.sand, minHeight: "100vh", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      {/* Nav */}
      <nav style={{ background: C.deep, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>🌊</span>
          <span style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>SOS Grande</span>
          <span style={{ color: "rgba(255,255,255,.3)", fontSize: 14 }}>/</span>
          <span style={{ color: "rgba(255,255,255,.6)", fontSize: 13 }}>{t("admin_dashboard_label")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LangToggle dark />
          <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(255,255,255,.2)", color: "rgba(255,255,255,.6)", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>
            {t("btn_signout")}
          </button>
        </div>
      </nav>

      {/* Tabs */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "0 20px", display: "flex", gap: 4 }}>
        {TABS.map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setSelected(null);
            }}
            style={{
              background: "none",
              border: "none",
              padding: "14px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              color: tab === k ? C.deep : C.muted,
              borderBottom: tab === k ? `2px solid ${C.foam}` : "2px solid transparent",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Stats */}
      {(tab === "submissions" || tab === "registrations") && (
        <div style={{ padding: "16px 20px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, maxWidth: 900 }}>
            {(tab === "submissions"
              ? [
                  [t("stat_total_subs"), statCounts.total, C.deep],
                  [t("stat_new"), statCounts.new, C.ocean],
                  [t("stat_shortlisted"), statCounts.shortlisted, "#a07800"],
                  [t("stat_schools"), statCounts.schools, C.foam],
                ]
              : [
                  [t("stat_registered"), statCounts.regs, C.deep],
                  [t("stat_submitted_art"), statCounts.submitted, C.foam],
                  [t("stat_reg_only"), statCounts.regs - statCounts.submitted, C.muted],
                ]
            ).map(([l, v, col]) => (
              <div key={l} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: col }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "16px 20px 40px", maxWidth: 900 }}>
        {tab === "submissions" && (
          <SubmissionsTab
            submissions={submissions}
            selected={selected}
            setSelected={setSelected}
            updateStatus={updateStatus}
            onDeleted={(id) => {
              setSubmissions((prev) => prev.filter((s) => s.id !== id));
              if (selected?.id === id) setSelected(null);
            }}
          />
        )}
        {tab === "registrations" && <RegistrationsTab registrations={registrations} />}
        {tab === "editor" && <ContentEditor contentAll={contentAll} setContentAll={setContentAll} />}
        {tab === "settings" && (
          <SettingsTab submissions={submissions} registrations={registrations} onWiped={reload} contestStatus={status} setContestStatus={setStatus} />
        )}
      </div>
    </div>
  );
}

// ── Submissions tab ───────────────────────────────────────────────────────────

const STATUS_KEYS = ["new", "reviewed", "shortlisted", "rejected"];
const STATUS_COLORS = {
  new: { bg: "#e6f0ff", fg: "#1a56c4" },
  reviewed: { bg: "#e6f5ee", fg: "#1a7a42" },
  shortlisted: { bg: "#fff7e0", fg: "#a07800" },
  rejected: { bg: C.coralBg, fg: C.coral },
};

function StatusBadge({ status }) {
  const { t } = useLang();
  const c = STATUS_COLORS[status] || STATUS_COLORS.new;
  const label = t(`status_${status}`) || t("status_new");
  return <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "3px 8px", background: c.bg, color: c.fg }}>{label}</span>;
}

function SubmissionsTab({ submissions, selected, setSelected, updateStatus, onDeleted }) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null); // submission pending delete confirmation

  const list = submissions.filter((s) => {
    const q = search.toLowerCase();
    return (!q || `${s.firstname} ${s.lastname} ${s.school} ${s.email}`.toLowerCase().includes(q)) && (!filter || s.status === filter);
  });

  const fmt = (iso) => new Date(iso).toLocaleDateString(LOCALES[lang], { month: "short", day: "numeric", year: "numeric" });

  const exportCSV = () => {
    downloadCSV(
      "submissions.csv",
      list,
      [
        ["firstname", "First name"],
        ["lastname", "Last name"],
        ["email", "Email"],
        ["school", "School"],
        ["grade", "Grade"],
        ["teammates", "Teammates"],
        ["status", "Status"],
        ["filename", "Artwork file"],
        ["fileSize", "File size"],
        ["statement", "Artist statement"],
        ["submittedAt", "Submitted at"],
      ]
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_placeholder")} style={{ ...inputStyle(false), flex: 1, minWidth: 180, fontSize: 13 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...inputStyle(false), width: "auto", paddingRight: 30 }}>
          <option value="">{t("filter_all_status")}</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>{t(`status_${k}`)}</option>
          ))}
        </select>
        <Btn variant="secondary" small onClick={exportCSV} disabled={list.length === 0}>
          {t("btn_export_csv")}
        </Btn>
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.muted }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
          <p>{t("no_submissions")}</p>
        </div>
      ) : (
        list.map((s) => (
          <div
            key={s.id}
            onClick={() => setSelected(selected?.id === s.id ? null : s)}
            style={{ background: C.white, border: `1.5px solid ${selected?.id === s.id ? C.foam : C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8, cursor: "pointer", transition: "border-color .15s" }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,2fr) 100px 90px", gap: 8, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.deep }}>
                  {s.firstname} {s.lastname}
                  {s.teammates ? " + team" : ""}
                </div>
                <div style={{ fontSize: 12, color: C.muted }}>{s.grade}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: C.muted }}>{s.school}</div>
                <div style={{ fontSize: 12, color: C.sandDark }}>{s.email}</div>
              </div>
              <StatusBadge status={s.status} />
              <div style={{ fontSize: 12, color: C.muted, textAlign: "right" }}>{fmt(s.submittedAt)}</div>
            </div>

            {selected?.id === s.id && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.sandMid}` }}>
                {s.artworkKey && (
                  <div style={{ marginBottom: 14, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, background: C.sand, maxHeight: 320, display: "flex", justifyContent: "center" }}>
                    <img
                      src={downloadUrl(s.artworkKey)}
                      alt={s.filename}
                      style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain" }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                  {[
                    [t("detail_school"), s.school],
                    [t("detail_grade"), s.grade],
                    [t("detail_teammates"), s.teammates || "—"],
                    [t("detail_email"), s.email],
                    [t("detail_file"), s.filename],
                    [t("detail_size"), s.fileSize],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: C.sand, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.deep, wordBreak: "break-all" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: C.sand, borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("statement_section")}</div>
                  <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.75, margin: 0 }}>{s.statement}</p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {STATUS_KEYS.map((k) => (
                    <Btn
                      key={k}
                      small
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(s.id, k);
                      }}
                      variant={s.status === k ? "foam" : "ghost"}
                    >
                      {t(`status_${k}`)}
                    </Btn>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {s.artworkKey ? (
                      <a href={downloadUrl(s.artworkKey)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}>
                        <Btn small variant="secondary">{t("btn_download_artwork")}</Btn>
                      </a>
                    ) : (
                      <Btn small variant="secondary" disabled>{t("btn_download_artwork")}</Btn>
                    )}
                    <Btn
                      small
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(s);
                      }}
                    >
                      {t("btn_delete_submission")}
                    </Btn>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {deleteTarget && (
        <DeleteSubmissionModal
          submission={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={() => {
            const id = deleteTarget.id;
            setDeleteTarget(null);
            if (selected?.id === id) setSelected(null);
            onDeleted?.(id);
          }}
        />
      )}
    </div>
  );
}

function DeleteSubmissionModal({ submission, onCancel, onDeleted }) {
  const { t } = useLang();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    if (!pass) return;
    setBusy(true);
    setError("");
    try {
      await deleteSubmission(submission.id, pass);
      onDeleted();
    } catch {
      setError(t("delete_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(14,32,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.white, borderRadius: 14, padding: "26px 24px", maxWidth: 400, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,.2)" }}
      >
        <h3 style={{ fontFamily: "Georgia,serif", fontSize: 19, color: C.deep, margin: "0 0 10px" }}>{t("delete_modal_title")}</h3>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 6 }}>
          {submission.firstname} {submission.lastname} — {submission.school}
        </p>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 16 }}>{t("delete_modal_body")}</p>
        {error && <div style={{ background: C.coralBg, color: C.coral, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label={t("label_password")}>
          <input
            autoFocus
            type="password"
            style={inputStyle(false)}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => e.key === "Enter" && confirm()}
          />
        </Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>{t("delete_modal_cancel")}</Btn>
          <Btn variant="danger" onClick={confirm} disabled={busy || !pass}>{busy ? t("delete_busy") : t("delete_modal_confirm")}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Registrations tab ─────────────────────────────────────────────────────────
function RegistrationsTab({ registrations }) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState("");
  const list = registrations.filter((r) => {
    const q = search.toLowerCase();
    return !q || `${r.firstname} ${r.lastname} ${r.school} ${r.email}`.toLowerCase().includes(q);
  });
  const fmt = (iso) => new Date(iso).toLocaleDateString(LOCALES[lang], { month: "short", day: "numeric", year: "numeric" });

  const exportCSV = () => {
    downloadCSV(
      "registrations.csv",
      list,
      [
        ["firstname", "First name"],
        ["lastname", "Last name"],
        ["email", "Email"],
        ["school", "School"],
        ["grade", "Grade"],
        ["teammates", "Teammates"],
        ["hasSubmitted", "Submitted artwork"],
        ["registeredAt", "Registered at"],
      ]
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_placeholder")} style={{ ...inputStyle(false), flex: 1, minWidth: 180, fontSize: 13 }} />
        <Btn variant="secondary" small onClick={exportCSV} disabled={list.length === 0}>
          {t("btn_export_csv")}
        </Btn>
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.muted }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
          <p>{t("no_registrations")}</p>
        </div>
      ) : (
        list.map((r) => (
          <div key={r.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,2fr) 100px 90px", gap: 8, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.deep }}>{r.firstname} {r.lastname}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{r.grade}{r.teammates ? ` · + ${r.teammates}` : ""}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: C.muted }}>{r.school}</div>
                <div style={{ fontSize: 12, color: C.sandDark }}>{r.email}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "3px 8px", background: r.hasSubmitted ? "#e6f5ee" : C.foamBg, color: r.hasSubmitted ? "#1a7a42" : C.ocean }}>
                {r.hasSubmitted ? t("label_reg_submitted") : t("label_reg_registered")}
              </span>
              <div style={{ fontSize: 12, color: C.muted, textAlign: "right" }}>{fmt(r.registeredAt)}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Settings tab (contest status + danger zone: wipe test data) ───────────────
const STATUS_OPTIONS = ["open", "not_open", "closed"];

function ContestStatusEditor({ contestStatus, setContestStatus }) {
  const { t } = useLang();
  const [draft, setDraft] = useState(contestStatus || DEFAULT_STATUS);
  const [msgLang, setMsgLang] = useState("en");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(contestStatus || DEFAULT_STATUS);
  }, [contestStatus]);

  const save = async () => {
    setSaving(true);
    await sSet(STATUS_KEY, draft);
    setContestStatus(draft);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{t("contest_status_section")}</div>
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>{t("contest_status_hint")}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {STATUS_OPTIONS.map((k) => (
          <button
            key={k}
            onClick={() => setDraft((p) => ({ ...p, status: k }))}
            style={{
              flex: "1 1 160px",
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 10,
              cursor: "pointer",
              border: `1.5px solid ${draft.status === k ? C.foam : C.border}`,
              background: draft.status === k ? C.foamBg : C.white,
              color: draft.status === k ? C.ocean : C.muted,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t(`status_option_${k}`)}
          </button>
        ))}
      </div>

      <Field label={t("label_closed_message")} hint={t("hint_closed_message")}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {["en", "es"].map((l) => (
            <button
              key={l}
              onClick={() => setMsgLang(l)}
              style={{
                background: msgLang === l ? C.foam : C.white,
                color: msgLang === l ? C.white : C.muted,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <textarea
          value={draft.closedMessage?.[msgLang] ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, closedMessage: { ...p.closedMessage, [msgLang]: e.target.value } }))}
          rows={3}
          style={{ ...inputStyle(false), resize: "vertical", lineHeight: 1.6 }}
        />
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {saved && <span style={{ fontSize: 13, color: "#1a7a42", fontWeight: 600 }}>{t("status_saved_label")}</span>}
        <Btn onClick={save} variant="foam" disabled={saving}>{t("btn_save_status")}</Btn>
      </div>
    </div>
  );
}

function SettingsTab({ submissions, registrations, onWiped, contestStatus, setContestStatus }) {
  const { t } = useLang();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [pass, setPass] = useState("");

  const canWipe = confirmText.trim().toUpperCase() === "DELETE" && pass.length > 0;

  const wipe = async () => {
    if (!canWipe) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await wipeTestData(pass);
      setResult(res);
      setConfirmText("");
      setPass("");
      onWiped?.();
    } catch {
      setError(t("wipe_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ContestStatusEditor contestStatus={contestStatus} setContestStatus={setContestStatus} />

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{t("settings_overview")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
          <div style={{ background: C.sand, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: C.muted }}>{t("stat_total_subs")}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.deep }}>{submissions.length}</div>
          </div>
          <div style={{ background: C.sand, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: C.muted }}>{t("stat_registered")}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.deep }}>{registrations.length}</div>
          </div>
        </div>
      </div>

      <div style={{ background: C.coralBg, border: `1.5px solid ${C.coral}`, borderRadius: 14, padding: "22px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.coral, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{t("danger_zone")}</div>
        <p style={{ fontSize: 13, color: C.ink, lineHeight: 1.7, marginBottom: 16 }}>{t("wipe_explainer")}</p>

        {result ? (
          <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: "#1a7a42" }}>
            {t("wipe_success")
              .replace("{subs}", result.deletedSubmissions)
              .replace("{regs}", result.deletedRegistrations)
              .replace("{files}", result.deletedArtworkFiles)}
          </div>
        ) : null}
        {error && <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: C.coral }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <Field label={t("label_password")}>
            <input type="password" style={inputStyle(false)} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label={t("wipe_confirm_label")} hint={t("wipe_confirm_hint")}>
            <input style={inputStyle(false)} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
          </Field>
        </div>

        <Btn variant="danger" onClick={wipe} disabled={!canWipe || busy}>
          {busy ? t("wipe_busy") : t("btn_wipe")}
        </Btn>
      </div>
    </div>
  );
}

// ── Content editor ────────────────────────────────────────────────────────────
function ContentEditor({ contentAll, setContentAll }) {
  const { t, lang } = useLang();
  const [editLang, setEditLang] = useState(lang);
  const [draft, setDraft] = useState({ ...contentAll[editLang] });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft({ ...contentAll[editLang] });
  }, [editLang]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setDraft((p) => ({ ...p, [k]: e.target.value }));
  const setList = (k, i) => (e) => {
    const arr = [...draft[k]];
    arr[i] = e.target.value;
    setDraft((p) => ({ ...p, [k]: arr }));
  };
  const addItem = (k) => setDraft((p) => ({ ...p, [k]: [...p[k], ""] }));
  const removeItem = (k, i) => setDraft((p) => ({ ...p, [k]: p[k].filter((_, j) => j !== i) }));

  const save = async () => {
    const updatedAll = { ...contentAll, [editLang]: draft };
    await sSet(CONTENT_KEY, updatedAll);
    setContentAll(updatedAll);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const ta = (k, rows = 2) => <textarea value={draft[k]} onChange={set(k)} rows={rows} style={{ ...inputStyle(false), resize: "vertical", lineHeight: 1.6 }} />;
  const inp = (k, ph = "") => <input value={draft[k]} onChange={set(k)} placeholder={ph} style={inputStyle(false)} />;

  const ListEditor = ({ field, label }) => (
    <Field label={label}>
      {draft[field].map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input value={item} onChange={setList(field, i)} style={{ ...inputStyle(false), flex: 1 }} />
          <button onClick={() => removeItem(field, i)} style={{ background: C.coralBg, border: "none", borderRadius: 6, color: C.coral, cursor: "pointer", padding: "0 10px", fontSize: 16 }}>✕</button>
        </div>
      ))}
      <Btn small variant="secondary" onClick={() => addItem(field)}>{t("btn_add_item")}</Btn>
    </Field>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.deep, margin: 0 }}>{t("editor_title")}</h2>
          <p style={{ fontSize: 13, color: C.muted, margin: "4px 0 0" }}>{t("editor_subtitle")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{t("editing_lang_label")}:</span>
            <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              {["en", "es"].map((l) => (
                <button
                  key={l}
                  onClick={() => setEditLang(l)}
                  style={{
                    background: editLang === l ? C.foam : C.white,
                    color: editLang === l ? C.white : C.muted,
                    border: "none",
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {saved && <span style={{ fontSize: 13, color: "#1a7a42", fontWeight: 600 }}>{t("saved_label")}</span>}
          <Btn onClick={save} variant="foam">{t("btn_save")}</Btn>
        </div>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>{t("section_hero_dates")}</div>
        <Field label={t("label_contest_name")}>{inp("contestName")}</Field>
        <Field label={t("label_tagline")}>{inp("tagline")}</Field>
        <Field label={t("label_hero_body")}>{ta("heroBody", 3)}</Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <Field label={t("label_deadline_label")}>{inp("deadlineLabel")}</Field>
          <Field label={t("label_deadline_date")}>{inp("deadlineDate", "e.g. March 15, 2025")}</Field>
          <Field label={t("label_announce_label")}>{inp("announcementLabel")}</Field>
          <Field label={t("label_announce_date")}>{inp("announcementDate")}</Field>
        </div>
      </div>

      <div style={{ background: "#fffbe6", border: "1px solid #f5c518", borderRadius: 14, padding: "22px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#7a5c00", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{t("section_memo")}</div>
        <Field label={t("label_memo_text")} hint={t("hint_memo")}>{ta("memo", 2)}</Field>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>{t("section_prize")}</div>
        <Field label={t("label_prize_title")}>{inp("prizeTitle")}</Field>
        <Field label={t("label_prize_desc")}>{ta("prizeBody", 3)}</Field>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>{t("section_guidelines")}</div>
        <Field label={t("label_theme_desc")}>{ta("theme", 3)}</Field>
        <Field label={t("label_statement_guide")}>{ta("statementGuide", 2)}</Field>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>{t("section_rules")}</div>
        <ListEditor field="eligibility" label={t("label_eligibility_rules")} />
        <Divider />
        <ListEditor field="artworkMust" label={t("label_artwork_must")} />
        <Divider />
        <ListEditor field="artworkMustNot" label={t("label_artwork_mustnot")} />
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.ocean, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>{t("section_contact")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("label_contact_email")}>{inp("contactEmail")}</Field>
          <Field label={t("label_website")}>{inp("contactWeb")}</Field>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        {saved && <span style={{ fontSize: 13, color: "#1a7a42", fontWeight: 600, alignSelf: "center" }}>{t("saved_label")}</span>}
        <Btn onClick={save} variant="foam">{t("btn_save")}</Btn>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT
// ═════════════════════════════════════════════════════════════════════════════

function Root() {
  const { t, lang } = useLang();
  const [view, setView] = useState("student"); // student | admin
  const [contentAll, setContentAll] = useState(DEFAULT_CONTENT);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([sGet(CONTENT_KEY), sGet(STATUS_KEY)]).then(([savedContent, savedStatus]) => {
      if (savedContent) {
        setContentAll({
          en: { ...DEFAULT_CONTENT.en, ...(savedContent.en || {}) },
          es: { ...DEFAULT_CONTENT.es, ...(savedContent.es || {}) },
        });
      }
      if (savedStatus) {
        setStatus({
          status: savedStatus.status || DEFAULT_STATUS.status,
          closedMessage: { ...DEFAULT_STATUS.closedMessage, ...(savedStatus.closedMessage || {}) },
        });
      }
      setReady(true);
    });
  }, []);

  if (!ready)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: C.sand, fontFamily: "sans-serif", color: C.muted, fontSize: 14 }}>
        {t("loading")}
      </div>
    );

  return (
    <div style={{ fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      {/* Top switcher */}
      <div style={{ background: C.ink, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "6px 12px" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {[
            ["student", t("topswitch_student")],
            ["admin", t("topswitch_admin")],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{
                background: view === k ? "rgba(255,255,255,.12)" : "transparent",
                border: "none",
                color: view === k ? C.white : "rgba(255,255,255,.4)",
                borderRadius: 6,
                padding: "4px 14px",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {view === "student" && <StudentPortal content={contentAll[lang]} status={status} />}
      {view === "admin" && <AdminGate contentAll={contentAll} setContentAll={setContentAll} status={status} setStatus={setStatus} />}
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Root />
    </LangProvider>
  );
}
