import { useState, useEffect } from "react";

// ─── Supabase config ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://vjgvlgwetrgikrlkqvrn.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZ3ZsZ3dldHJnaWtybGtxdnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzc0MzYsImV4cCI6MjA5MzgxMzQzNn0.Vp4VqMKjCwE1PCu_ogUe537LrCepNzo8E-_GYr6LMNc";

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

// ─── Supabase DB helpers ──────────────────────────────────────────────────────
const DB = {
  // Docenten
  async getTeacherByEmail(email) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/teachers?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers }
    );
    const data = await res.json();
    return data[0] || null;
  },

  async createTeacher(name, email, passwordHash) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/teachers`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ name, email, password_hash: passwordHash }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Registratie mislukt");
    return data[0];
  },

  // Klassen
  async getRoomsByTeacher(teacherId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rooms?teacher_id=eq.${teacherId}&order=created_at.desc`,
      { headers }
    );
    return res.json();
  },

  async getRoomByCode(code) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rooms?code=eq.${code}&limit=1`,
      { headers }
    );
    const data = await res.json();
    return data[0] || null;
  },

  async createRoom(teacherId, name, code) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rooms`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ teacher_id: teacherId, name, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Aanmaken mislukt");
    return data[0];
  },

  async deleteRoom(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/rooms?id=eq.${id}`, {
      method: "DELETE", headers,
    });
  },

  async pauseRoom(id, paused) {
    await fetch(`${SUPABASE_URL}/rest/v1/rooms?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ paused }),
    });
  },

  // Inleveringen
  async getSubmissions(roomCode) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/submissions?room_code=eq.${roomCode}&order=submitted_at.desc`,
      { headers }
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(sub => {
      let quiz = sub.quiz;
      // Quiz kan een string, object of al geparsed zijn
      if (typeof quiz === "string") {
        try { quiz = JSON.parse(quiz); } catch { quiz = null; }
      }
      return { ...sub, quiz };
    });
  },

  async addSubmission(roomCode, studentName, imageBase64, quiz) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({
        room_code: roomCode,
        student_name: studentName,
        image_base64: imageBase64,
        // Sla quiz op als JSON string zodat het altijd correct wordt opgeslagen
        quiz: typeof quiz === "string" ? quiz : JSON.stringify(quiz),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Inleveren mislukt");
    return data[0];
  },
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────
async function hashPassword(pw) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pw + "nieuwsklas_salt")
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

const Auth = {
  async register(name, email, pw) {
    const existing = await DB.getTeacherByEmail(email.toLowerCase().trim());
    if (existing) return { error: "Er bestaat al een account met dit e-mailadres." };
    const hash = await hashPassword(pw);
    try {
      // Nieuw account krijgt status 'pending' — wacht op goedkeuring beheerder
      const teacher = await DB.createTeacher(name.trim(), email.toLowerCase().trim(), hash);
      return { ok: true, pending: true, teacher };
    } catch (e) {
      return { error: e.message };
    }
  },

  async login(email, pw) {
    const teacher = await DB.getTeacherByEmail(email.toLowerCase().trim());
    if (!teacher) return { error: "Geen account gevonden met dit e-mailadres." };
    const hash = await hashPassword(pw);
    if (teacher.password_hash !== hash) return { error: "Onjuist wachtwoord." };
    if (teacher.status === "pending") return { error: "Je aanvraag is nog in behandeling. Je ontvangt een e-mail zodra je account is goedgekeurd." };
    if (teacher.status === "rejected") return { error: "Je aanvraag is helaas afgekeurd. Neem contact op met de beheerder voor meer informatie." };
    return { ok: true, teacher };
  },
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const genCode = () =>
  Array.from({ length: 6 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]
  ).join("");

// Verkleint en comprimeert de afbeelding voor opslag en AI-analyse
const toBase64 = file =>
  new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // Max 800px breed of hoog, behoud verhoudingen
      const MAX = 800;
      let { width, height } = img;
      if (width > height && width > MAX) {
        height = Math.round((height * MAX) / width);
        width = MAX;
      } else if (height > width && height > MAX) {
        width = Math.round((width * MAX) / height);
        height = MAX;
      } else if (width > MAX) {
        height = Math.round((height * MAX) / width);
        width = MAX;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      // Kwaliteit 0.75 geeft goede balans tussen kwaliteit en bestandsgrootte
      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      res(dataUrl.split(",")[1]);
    };
    img.onerror = () => rej(new Error("Afbeelding laden mislukt"));
    img.src = url;
  });

async function generateQuiz(b64) {
  const resp = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: b64 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Quiz genereren mislukt");
  return data.quiz;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:         "#F0F4FF",
  surface:    "#FFFFFF",
  surfaceAlt: "#F7F9FF",
  border:     "#E2E8F4",
  blue:       "#3B6FF0",
  blueDark:   "#2952C8",
  blueLight:  "#EEF2FF",
  text:       "#0F1523",
  sub:        "#6B7A99",
  green:      "#16A34A",
  greenLight: "#DCFCE7",
  red:        "#DC2626",
  redLight:   "#FEE2E2",
  amber:      "#D97706",
  white:      "#FFFFFF",
};

// ─── UI primitives ────────────────────────────────────────────────────────────
const Tag = ({ children, color = "blue" }) => {
  const map = {
    blue:  { bg: C.blueLight,  text: C.blue },
    green: { bg: C.greenLight, text: C.green },
    red:   { bg: C.redLight,   text: C.red },
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      background: map[color].bg, color: map[color].text,
      borderRadius: 99, padding: "3px 10px",
      fontSize: 11, fontWeight: 600,
    }}>{children}</span>
  );
};

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

const TextInput = ({ label, inputStyle, ...props }) => (
  <Field label={label}>
    <input
      style={{
        width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 10,
        padding: "11px 14px", fontSize: 15, fontFamily: "inherit", color: C.text,
        outline: "none", background: C.surface,
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxSizing: "border-box", ...inputStyle,
      }}
      onFocus={e => { e.target.style.borderColor = C.blue; e.target.style.boxShadow = `0 0 0 3px ${C.blueLight}`; }}
      onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
      {...props}
    />
  </Field>
);

const PrimaryBtn = ({ children, full, small, disabled, style, ...props }) => (
  <button disabled={disabled} style={{
    background: disabled ? C.border : `linear-gradient(135deg, ${C.blue}, ${C.blueDark})`,
    color: disabled ? C.sub : C.white,
    border: "none", borderRadius: 10,
    padding: small ? "8px 18px" : "13px 24px",
    fontSize: small ? 13 : 15, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    width: full ? "100%" : "auto",
    boxShadow: disabled ? "none" : "0 2px 8px rgba(59,111,240,0.25)",
    transition: "opacity 0.15s", letterSpacing: 0.2,
    ...style,
  }}
  onMouseEnter={e => !disabled && (e.currentTarget.style.opacity = "0.88")}
  onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
  {...props}>{children}</button>
);

const GhostBtn = ({ children, style, ...props }) => (
  <button style={{
    background: "transparent", color: C.sub,
    border: `1.5px solid ${C.border}`, borderRadius: 8,
    padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer",
    transition: "border-color 0.15s, color 0.15s", whiteSpace: "nowrap",
    ...style,
  }}
  onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.sub; }}
  {...props}>{children}</button>
);

const Card = ({ children, style }) => (
  <div style={{
    background: C.surface, borderRadius: 16,
    border: `1px solid ${C.border}`,
    boxShadow: "0 1px 4px rgba(15,21,35,0.05)",
    ...style,
  }}>{children}</div>
);

const Spinner = ({ label }) => (
  <div style={{ textAlign: "center", padding: "60px 20px" }}>
    <div style={{
      width: 40, height: 40, borderRadius: "50%",
      border: `3px solid ${C.border}`, borderTopColor: C.blue,
      animation: "spin 0.8s linear infinite", margin: "0 auto 16px",
    }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{label}</div>
    <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>Dit kan even duren…</div>
  </div>
);

const ErrorBox = ({ msg }) => msg ? (
  <div style={{
    background: C.redLight, border: `1.5px solid ${C.red}`,
    borderRadius: 10, padding: "10px 14px",
    fontSize: 13, color: C.red, marginBottom: 16,
  }}>{msg}</div>
) : null;

// ─── Article Modal ────────────────────────────────────────────────────────────
function ArticleModal({ sub, onClose }) {
  // Sluit op Escape
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,21,35,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.surface, borderRadius: 16,
          boxShadow: "0 20px 60px rgba(15,21,35,0.25)",
          width: "100%", maxWidth: 780,
          maxHeight: "90vh", display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Modal header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{sub.quiz.title}</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
              Ingeleverd door <strong style={{ color: C.text }}>{sub.student_name}</strong>
              {" · "}
              {new Date(sub.submitted_at).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
              {" om "}
              {new Date(sub.submitted_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 8, width: 32, height: 32, fontSize: 16,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: C.sub, flexShrink: 0, marginLeft: 16,
          }}>✕</button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: "auto", padding: "20px" }}>
          {/* Full article image */}
          <div style={{
            background: C.bg, borderRadius: 10, overflow: "hidden",
            border: `1px solid ${C.border}`, marginBottom: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img
              src={`data:image/jpeg;base64,${sub.image_base64}`}
              alt="Nieuwsartikel"
              style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: "60vh" }}
            />
          </div>

          {/* Summary */}
          <div style={{
            background: C.blueLight, borderRadius: 10, padding: "12px 16px",
            fontSize: 13, color: C.blue, fontStyle: "italic", lineHeight: 1.6,
            marginBottom: 20, border: `1px solid ${C.blueMid || C.border}`,
          }}>
            📝 {sub.quiz.summary}
          </div>

          {/* Questions overview */}
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
            Gegenereerde vragen
          </div>
          {sub.quiz.questions.map((q, qi) => (
            <div key={qi} style={{
              background: C.surfaceAlt, borderRadius: 10, padding: "12px 14px",
              marginBottom: 10, border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 8 }}>
                {qi + 1}. {q.question}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {q.options.map((opt, oi) => (
                  <div key={oi} style={{
                    fontSize: 12, padding: "5px 10px", borderRadius: 6,
                    background: oi === q.correct ? C.greenLight : "transparent",
                    color: oi === q.correct ? C.green : C.sub,
                    fontWeight: oi === q.correct ? 600 : 400,
                    border: `1px solid ${oi === q.correct ? C.green : "transparent"}`,
                  }}>
                    {opt} {oi === q.correct ? "✓" : ""}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── QuizCard ─────────────────────────────────────────────────────────────────
function QuizCard({ sub }) {
  const [open,      setOpen]      = useState(false);
  const [ans,       setAns]       = useState({});
  const [done,      setDone]      = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Veiligheidscheck — als quiz data ontbreekt laat een foutkaart zien
  const quiz = sub.quiz && typeof sub.quiz === "object" ? sub.quiz : null;
  if (!quiz || !Array.isArray(quiz.questions)) {
    return (
      <Card style={{ marginBottom: 10, padding: "14px 18px" }}>
        <div style={{ fontSize: 13, color: C.sub }}>
          ⚠️ <strong>{sub.student_name}</strong> — quiz data kon niet worden geladen.
        </div>
      </Card>
    );
  }

  const allAnswered = quiz.questions.every((_, i) => ans[i] !== undefined);
  const score = done ? quiz.questions.filter((q, i) => ans[i] === q.correct).length : null;

  return (
    <>
      {showModal && <ArticleModal sub={{ ...sub, quiz }} onClose={() => setShowModal(false)} />}
      <Card style={{ marginBottom: 10, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 18px", cursor: "pointer",
        background: open ? C.surfaceAlt : C.surface,
        borderBottom: open ? `1px solid ${C.border}` : "none",
        transition: "background 0.15s",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {quiz.title}
          </div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>
            <span style={{ fontWeight: 600, color: C.text }}>{sub.student_name}</span>
            {" · "}
            {new Date(sub.submitted_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
            {" · "}
            {new Date(sub.submitted_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 12, flexShrink: 0 }}>
          <Tag color="blue">4 vragen</Tag>
          <span style={{ color: C.sub, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "18px 20px" }}>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: C.sub, fontStyle: "italic", lineHeight: 1.6 }}>
            {quiz.summary}
          </p>

          {/* Klikbaar artikel-preview */}
          <div
            onClick={() => setShowModal(true)}
            title="Klik om het artikel volledig te bekijken"
            style={{ position: "relative", cursor: "pointer", marginBottom: 20, borderRadius: 10, overflow: "hidden" }}
          >
            <img
              src={`data:image/jpeg;base64,${sub.image_base64}`}
              alt="Screenshot"
              style={{ width: "100%", maxHeight: 180, objectFit: "cover", display: "block", border: `1px solid ${C.border}` }}
            />
            {/* Hover overlay */}
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(59,111,240,0.0)",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(59,111,240,0.35)";
              e.currentTarget.querySelector("span").style.opacity = "1";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(59,111,240,0)";
              e.currentTarget.querySelector("span").style.opacity = "0";
            }}>
              <span style={{
                opacity: 0, transition: "opacity 0.2s",
                background: C.white, color: C.blue,
                borderRadius: 99, padding: "6px 16px",
                fontSize: 12, fontWeight: 700,
                boxShadow: "0 2px 8px rgba(15,21,35,0.15)",
              }}>🔍 Artikel openen</span>
            </div>
          </div>

          {quiz.questions.map((q, qi) => (
            <div key={qi} style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 8, lineHeight: 1.4 }}>
                {qi + 1}. {q.question}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {q.options.map((opt, oi) => {
                  let bg = C.surfaceAlt, border = C.border, col = C.text, fw = 400;
                  if (ans[qi] === oi)                           { bg = C.blueLight;  border = C.blue;  col = C.blue;  fw = 600; }
                  if (done && oi === q.correct)                 { bg = C.greenLight; border = C.green; col = C.green; fw = 600; }
                  if (done && ans[qi] === oi && oi !== q.correct){ bg = C.redLight;   border = C.red;   col = C.red;   fw = 600; }
                  return (
                    <button key={oi} onClick={() => !done && setAns(a => ({ ...a, [qi]: oi }))} style={{
                      background: bg, color: col, border: `1.5px solid ${border}`,
                      borderRadius: 8, padding: "9px 11px", fontSize: 13, textAlign: "left",
                      cursor: done ? "default" : "pointer", fontWeight: fw,
                      fontFamily: "inherit", transition: "all 0.12s",
                    }}>{opt}</button>
                  );
                })}
              </div>
            </div>
          ))}

          {!done ? (
            <PrimaryBtn onClick={() => setDone(true)} disabled={!allAnswered}>
              Nakijken
            </PrimaryBtn>
          ) : (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: score === 4 ? C.greenLight : score >= 2 ? "#FEF9C3" : C.redLight,
              color:      score === 4 ? C.green      : score >= 2 ? C.amber   : C.red,
              border: `1.5px solid ${score === 4 ? C.green : score >= 2 ? "#FDE047" : C.red}`,
              borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 15,
            }}>
              {score}/4 goed {score === 4 ? "🎉" : score >= 2 ? "👍" : "📖"}
            </div>
          )}
        </div>
      )}
    </Card>
    </>
  );
}

// ─── TEACHER AUTH ─────────────────────────────────────────────────────────────
function TeacherAuthGate({ onBack }) {
  const [mode,    setMode]    = useState("login");
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [pw,      setPw]      = useState("");
  const [pw2,     setPw2]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [teacher, setTeacher] = useState(null);

  const submit = async () => {
    setError("");
    if (!email.trim() || !pw.trim()) return setError("Vul alle velden in.");
    if (mode === "register") {
      if (!name.trim())   return setError("Vul je naam in.");
      if (pw.length < 6)  return setError("Wachtwoord moet minimaal 6 tekens zijn.");
      if (pw !== pw2)     return setError("Wachtwoorden komen niet overeen.");
    }
    setLoading(true);
    const result = mode === "login"
      ? await Auth.login(email, pw)
      : await Auth.register(name, email, pw);
    setLoading(false);
    if (result.error) return setError(result.error);
    if (result.pending) {
      setMode("pending");
      return;
    }
    setTeacher(result.teacher);
  };

  if (teacher) return <TeacherView teacher={teacher} onLogout={() => setTeacher(null)} />;

  // Aanvraag ingediend — wacht op goedkeuring
  if (mode === "pending") return (
    <div style={{ flex:1, overflowY:"auto", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ width:"100%", maxWidth:400, textAlign:"center" }}>
        <div style={{ width:64, height:64, borderRadius:20, background:"#FEF9C3", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, margin:"0 auto 16px" }}>⏳</div>
        <div style={{ fontWeight:700, fontSize:22, color:C.text, marginBottom:8 }}>Aanvraag ingediend!</div>
        <Card style={{ padding:"20px 22px", textAlign:"left" }}>
          <p style={{ fontSize:14, color:C.sub, lineHeight:1.7, margin:"0 0 12px" }}>
            Je aanvraag voor een docentaccount is ontvangen en wordt beoordeeld door de beheerder.
          </p>
          <p style={{ fontSize:14, color:C.sub, lineHeight:1.7, margin:0 }}>
            Je ontvangt een <strong style={{ color:C.text }}>e-mail</strong> zodra je aanvraag is goedgekeurd of afgekeurd.
          </p>
        </Card>
        <button onClick={() => { setMode("login"); setError(""); }} style={{ marginTop:16, background:"none", border:"none", color:C.blue, fontWeight:600, cursor:"pointer", fontSize:13 }}>
          ← Terug naar inloggen
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: `linear-gradient(135deg,${C.blue},${C.blueDark})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, margin: "0 auto 14px",
            boxShadow: "0 4px 14px rgba(59,111,240,0.3)",
          }}>👨‍🏫</div>
          <div style={{ fontWeight: 700, fontSize: 22, color: C.text }}>
            {mode === "login" ? "Inloggen als docent" : "Account aanmaken"}
          </div>
          <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>
            {mode === "login" ? "Welkom terug!" : "Maak een gratis docentaccount aan"}
          </div>
        </div>

        <Card style={{ padding: "24px 22px" }}>
          {mode === "register" && (
            <TextInput label="Jouw naam" value={name} onChange={e => setName(e.target.value)} placeholder="Voornaam Achternaam" />
          )}
          <TextInput label="E-mailadres" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jouw@email.nl" />
          <TextInput label="Wachtwoord" type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Minimaal 6 tekens" />
          {mode === "register" && (
            <TextInput label="Wachtwoord herhalen" type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Herhaal wachtwoord" />
          )}

          <ErrorBox msg={error} />

          <PrimaryBtn full disabled={loading} onClick={submit}>
            {loading ? "Even geduld…" : mode === "login" ? "Inloggen →" : "Account aanmaken →"}
          </PrimaryBtn>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: C.sub }}>
            {mode === "login" ? (
              <>Nog geen account?{" "}
                <button onClick={() => { setMode("register"); setError(""); }} style={{ background: "none", border: "none", color: C.blue, fontWeight: 600, cursor: "pointer", fontSize: 13, padding: 0 }}>
                  Registreren
                </button>
              </>
            ) : (
              <>Al een account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }} style={{ background: "none", border: "none", color: C.blue, fontWeight: 600, cursor: "pointer", fontSize: 13, padding: 0 }}>
                  Inloggen
                </button>
              </>
            )}
          </div>
        </Card>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 13 }}>
            ← Terug naar startpagina
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TEACHER VIEW ─────────────────────────────────────────────────────────────
function TeacherView({ teacher, onLogout }) {
  const [rooms,          setRooms]         = useState([]);
  const [selected,       setSelected]      = useState(null);
  const [subs,           setSubs]          = useState([]);
  const [newName,        setNewName]       = useState("");
  const [creating,       setCreating]      = useState(false);
  const [loading,        setLoading]       = useState(true);
  const [loadingSubs,    setLoadingSubs]   = useState(false);
  const [roomError,      setRoomError]     = useState("");
  const [showStudentList,setShowStudentList] = useState(false);

  // Sluit de leerlingenlijst als je erbuiten klikt
  useEffect(() => {
    if (!showStudentList) return;
    const handler = () => setShowStudentList(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showStudentList]);

  const [downloading, setDownloading] = useState(false);

  const downloadAllScreenshots = async () => {
    if (subs.length === 0) return;
    setDownloading(true);

    try {
      const JSZip = require("jszip");
      const zip = new JSZip();
      const folder = zip.folder(selected.name);

      subs.forEach((sub, i) => {
        if (!sub.image_base64) return;
        const naamDelen = sub.student_name.trim().split(" ");
        const achternaam = naamDelen.pop();
        const voornaam = naamDelen.join("_") || "onbekend";
        const bestandsnaam = `${achternaam}_${voornaam}_${i + 1}.jpg`;
        folder.file(bestandsnaam, sub.image_base64, { base64: true });
      });

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selected.name}_screenshots.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download mislukt:", err);
      alert("Download mislukt. Probeer opnieuw.");
    }

    setDownloading(false);
  };

  const loadRooms = async () => {
    const data = await DB.getRoomsByTeacher(teacher.id);
    setRooms(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { loadRooms(); }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingSubs(true);
    DB.getSubmissions(selected.code).then(data => {
      setSubs(Array.isArray(data) ? data : []);
      setLoadingSubs(false);
    });
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => {
      DB.getSubmissions(selected.code).then(data => setSubs(Array.isArray(data) ? data : []));
    }, 5000);
    return () => clearInterval(id);
  }, [selected]);

  const createRoom = async () => {
    setRoomError("");
    if (!newName.trim()) return;
    const code = genCode();
    try {
      const room = await DB.createRoom(teacher.id, newName.trim(), code);
      setRooms(r => [room, ...r]);
      setNewName(""); setCreating(false);
      setSelected(room); setSubs([]);
    } catch (e) {
      setRoomError("Aanmaken mislukt, probeer opnieuw.");
    }
  };

  const deleteRoom = async (room) => {
    if (!confirm(`Klas "${room.name}" verwijderen? Alle inleveringen gaan verloren.`)) return;
    await DB.deleteRoom(room.id);
    setRooms(r => r.filter(x => x.id !== room.id));
    if (selected?.id === room.id) { setSelected(null); setSubs([]); }
  };

  const togglePause = async (room, e) => {
    e.stopPropagation();
    const newPaused = !room.paused;
    await DB.pauseRoom(room.id, newPaused);
    setRooms(r => r.map(x => x.id === room.id ? { ...x, paused: newPaused } : x));
    if (selected?.id === room.id) setSelected(s => ({ ...s, paused: newPaused }));
  };

  if (loading) return <Spinner label="Klassen laden…" />;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{
        width: 256, background: C.surface, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", flexShrink: 0,
      }}>
        {/* Teacher identity */}
        <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
            Mijn klassen
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 99,
                background: C.blueLight, color: C.blue,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700,
              }}>{teacher?.name?.[0]?.toUpperCase() || "?"}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{teacher?.name}</div>
            </div>
            <button onClick={onLogout} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 12, color: C.sub, padding: "4px 6px", borderRadius: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.color = C.red}
            onMouseLeave={e => e.currentTarget.style.color = C.sub}
            >Uitloggen</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 0" }}>
          {rooms.length === 0 && !creating && (
            <div style={{ textAlign: "center", padding: "32px 12px", color: C.sub, fontSize: 13 }}>
              Nog geen klassen.<br />Maak er een aan ↓
            </div>
          )}
          {rooms.map(room => (
            <div key={room.id} onClick={() => setSelected(room)} style={{
              padding: "10px 12px", borderRadius: 10, marginBottom: 4, cursor: "pointer",
              background: selected?.id === room.id ? C.blueLight : "transparent",
              border: `1.5px solid ${selected?.id === room.id ? C.blue : "transparent"}`,
              transition: "all 0.15s",
              opacity: room.paused ? 0.7 : 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: selected?.id === room.id ? C.blue : C.text, display: "flex", alignItems: "center", gap: 6 }}>
                  {room.name}
                  {room.paused && <span style={{ fontSize: 10, background: C.redLight, color: C.red, borderRadius: 99, padding: "1px 6px", fontWeight: 600 }}>Gepauzeerd</span>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <span
                    onClick={e => togglePause(room, e)}
                    title={room.paused ? "Deblokkeren" : "Pauzeren"}
                    style={{ fontSize: 13, cursor: "pointer", padding: "0 2px", opacity: 0.6 }}
                  >{room.paused ? "▶️" : "⏸️"}</span>
                  <span
                    onClick={e => { e.stopPropagation(); deleteRoom(room); }}
                    title="Verwijderen"
                    style={{ fontSize: 13, color: C.sub, cursor: "pointer", opacity: 0.5, padding: "0 2px" }}
                  >✕</span>
                </div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 3, marginTop: 2, color: selected?.id === room.id ? C.blue : C.sub }}>
                {room.code}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: 10, borderTop: `1px solid ${C.border}` }}>
          {roomError && <div style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>{roomError}</div>}
          {creating ? (
            <div>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createRoom()}
                placeholder="Naam van de klas…"
                style={{
                  width: "100%", border: `1.5px solid ${C.blue}`, borderRadius: 10,
                  padding: "9px 12px", fontSize: 14, outline: "none",
                  boxSizing: "border-box", fontFamily: "inherit", color: C.text, marginBottom: 8,
                  boxShadow: `0 0 0 3px ${C.blueLight}`,
                }} />
              <div style={{ display: "flex", gap: 6 }}>
                <PrimaryBtn small onClick={createRoom} style={{ flex: 1 }}>Aanmaken</PrimaryBtn>
                <GhostBtn onClick={() => setCreating(false)} style={{ flex: 1, padding: "8px 12px" }}>Annuleer</GhostBtn>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={{
              width: "100%", background: "transparent",
              border: `1.5px dashed ${C.border}`, borderRadius: 10,
              padding: "10px", color: C.sub, fontSize: 13,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; e.currentTarget.style.background = C.blueLight; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.sub; e.currentTarget.style.background = "transparent"; }}
            >+ Nieuwe klas</button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflowY: "auto", padding: 28, background: C.bg }}>
        {!selected ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20, background: C.blueLight,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
            }}>📚</div>
            <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>Selecteer een klas</div>
            <div style={{ fontSize: 14, color: C.sub }}>of maak een nieuwe aan in de zijbalk</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700, color: C.text }}>
                  {selected.name}
                  {selected.paused && (
                    <span style={{ marginLeft: 10, fontSize: 13, background: C.redLight, color: C.red, borderRadius: 99, padding: "3px 10px", fontWeight: 600, verticalAlign: "middle" }}>
                      ⏸ Gepauzeerd
                    </span>
                  )}
                </h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => togglePause(selected, { stopPropagation: () => {} })}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: selected.paused ? C.greenLight : C.redLight,
                      color: selected.paused ? C.green : C.red,
                      border: `1.5px solid ${selected.paused ? C.green : C.red}`,
                      borderRadius: 10, padding: "8px 16px",
                      fontSize: 13, fontWeight: 600, cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {selected.paused ? "▶️ Deblokkeren" : "⏸️ Pauzeren"}
                  </button>
                  {subs.length > 0 && (
                    <button
                      onClick={downloadAllScreenshots}
                      disabled={downloading}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        background: downloading ? C.border : C.surface,
                        color: downloading ? C.sub : C.blue,
                        border: `1.5px solid ${downloading ? C.border : C.blue}`,
                        borderRadius: 10, padding: "8px 16px",
                        fontSize: 13, fontWeight: 600, cursor: downloading ? "not-allowed" : "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {downloading ? "⏳ Downloaden…" : "⬇️ Download alle screenshots"}
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: C.sub }}>Code voor leerlingen:</span>
                <span style={{
                  fontFamily: "monospace", fontWeight: 800, fontSize: 20, letterSpacing: 5,
                  color: C.blue, background: C.blueLight, padding: "4px 14px", borderRadius: 8,
                }}>{selected.code}</span>

                {/* Klikbare inlevering-teller met uitklaplijst */}
                <div style={{ position: "relative" }}>
                  <button
                    onClick={e => { e.stopPropagation(); setShowStudentList(o => !o); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: C.blueLight, color: C.blue,
                      border: `1.5px solid ${showStudentList ? C.blue : "transparent"}`,
                      borderRadius: 99, padding: "4px 12px",
                      fontSize: 11, fontWeight: 600, cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                  >
                    {subs.length} inlevering{subs.length !== 1 ? "en" : ""}
                    <span style={{ fontSize: 10 }}>{showStudentList ? "▲" : "▼"}</span>
                  </button>

                  {/* Uitklaplijst leerlingen */}
                  {showStudentList && subs.length > 0 && (
                    <div onClick={e => e.stopPropagation()} style={{
                      position: "absolute", top: "calc(100% + 8px)", left: 0,
                      background: C.surface, border: `1.5px solid ${C.border}`,
                      borderRadius: 12, boxShadow: "0 4px 20px rgba(15,21,35,0.12)",
                      zIndex: 100, minWidth: 240, maxHeight: 320, overflowY: "auto",
                    }}>
                      <div style={{
                        padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
                        fontSize: 11, fontWeight: 700, color: C.sub,
                        textTransform: "uppercase", letterSpacing: 0.8,
                      }}>
                        Ingeleverd door
                      </div>
                      {[...subs]
                        .sort((a, b) => {
                          // Sorteer op achternaam (laatste woord van de naam)
                          const achternaamA = a.student_name.trim().split(" ").pop().toLowerCase();
                          const achternaamB = b.student_name.trim().split(" ").pop().toLowerCase();
                          return achternaamA.localeCompare(achternaamB, "nl");
                        })
                        .map((s, i) => {
                          const delen = s.student_name.trim().split(" ");
                          const achternaam = delen.pop();
                          const voornaam = delen.join(" ");
                          return (
                            <div key={s.id} style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "10px 14px",
                              borderBottom: i < subs.length - 1 ? `1px solid ${C.border}` : "none",
                              background: i % 2 === 0 ? C.surface : C.surfaceAlt,
                            }}>
                              <div style={{
                                width: 30, height: 30, borderRadius: 99, flexShrink: 0,
                                background: C.blueLight, color: C.blue,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700,
                              }}>
                                {achternaam[0]?.toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                                  {achternaam}{voornaam ? `, ${voornaam}` : ""}
                                </div>
                                <div style={{ fontSize: 11, color: C.sub, marginTop: 1 }}>
                                  {new Date(s.submitted_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                                  {" om "}
                                  {new Date(s.submitted_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.sub, letterSpacing: 0.8, textTransform: "uppercase" }}>Inleveringen</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            {loadingSubs ? <Spinner label="Inleveringen ophalen…" /> :
              subs.length === 0 ? (
                <Card style={{ padding: "40px 24px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                  <div style={{ fontWeight: 600, fontSize: 16, color: C.text, marginBottom: 6 }}>Nog geen inleveringen</div>
                  <div style={{ fontSize: 14, color: C.sub }}>
                    Leerlingen leveren in via code{" "}
                    <strong style={{ fontFamily: "monospace", letterSpacing: 3, color: C.blue }}>{selected.code}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>Ververst automatisch elke 5 seconden</div>
                </Card>
              ) : subs.map(s => <QuizCard key={s.id} sub={s} />)
            }
          </>
        )}
      </main>
    </div>
  );
}

// ─── STUDENT VIEW ─────────────────────────────────────────────────────────────
function StudentView() {
  const [step,    setStep]    = useState("form");
  const [code,    setCode]    = useState("");
  const [name,    setName]    = useState("");
  const [file,    setFile]    = useState(null);
  const [preview, setPreview] = useState(null);
  const [error,   setError]   = useState("");
  const [status,  setStatus]  = useState("");

  const handleFile = f => {
    if (!f) return;
    setFile(f);
    const r = new FileReader();
    r.onload = e => setPreview(e.target.result);
    r.readAsDataURL(f);
  };

  const submit = async () => {
    setError("");
    const uc = code.toUpperCase().trim();
    const room = await DB.getRoomByCode(uc);
    if (!room)         return setError("Onbekende klascode. Vraag je docent om de juiste code.");
    if (room.paused)   return setError("De inlevering voor deze klas is tijdelijk gesloten door de docent. Probeer het later opnieuw.");
    if (!name.trim())  return setError("Vul je naam in.");
    if (!file)         return setError("Kies een screenshot van een nieuwsbericht.");

    setStep("processing"); setStatus("Afbeelding uploaden…");
    try {
      const b64 = await toBase64(file);
      setStatus("Afbeelding verwerken…");
      const quiz = await generateQuiz(b64);
      setStatus("Inlevering opslaan…");
      await DB.addSubmission(uc, name.trim(), b64, quiz);
      setStep("done");
    } catch (e) {
      setError("Er ging iets mis: " + e.message);
      setStep("form");
    }
  };

  if (step === "processing") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, background: C.bg }}>
      <Spinner label={status} />
    </div>
  );

  if (step === "done") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, padding: 24, background: C.bg }}>
      <div style={{
        width: 80, height: 80, borderRadius: 24, background: C.greenLight,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36,
      }}>✅</div>
      <div style={{ fontWeight: 700, fontSize: 22, color: C.text }}>Ingeleverd!</div>
      <div style={{ fontSize: 14, color: C.sub, textAlign: "center", maxWidth: 300, lineHeight: 1.6 }}>
        Je nieuwsbericht is opgeslagen en er zijn automatisch vragen van gemaakt. Je docent kan ze nu bekijken.
      </div>
      <PrimaryBtn onClick={() => { setStep("form"); setFile(null); setPreview(null); setName(""); setCode(""); }}>
        Nieuw artikel inleveren
      </PrimaryBtn>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "28px 20px" }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: C.text }}>Nieuws inleveren</h2>
          <div style={{ fontSize: 13, color: C.sub }}>Upload een screenshot van een nieuwsartikel</div>
        </div>

        <Card style={{ padding: "22px 20px" }}>
          <TextInput label="Klascode"
            value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="bijv. A3K9ZX" maxLength={6}
            inputStyle={{ fontFamily: "monospace", fontWeight: 700, fontSize: 22, letterSpacing: 6, color: C.blue }}
          />
          <TextInput label="Jouw naam"
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Voornaam Achternaam"
          />

          <Field label="Screenshot nieuwsbericht">
            {preview ? (
              <div style={{ border: `1.5px solid ${C.blue}`, borderRadius: 12, overflow: "hidden" }}>
                <img src={preview} alt="Preview" style={{ width: "100%", display: "block", maxHeight: 240, objectFit: "contain" }} />
                <label style={{
                  display: "block", padding: "11px", textAlign: "center",
                  background: C.surfaceAlt, borderTop: `1px solid ${C.border}`,
                  fontSize: 13, color: C.sub, cursor: "pointer", boxSizing: "border-box",
                }}>
                  ✕ Andere afbeelding kiezen
                  <input type="file" accept="image/*" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} />
                </label>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{
                  background: C.surfaceAlt, border: `1.5px dashed ${C.border}`,
                  borderRadius: 12, padding: "22px 10px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  boxSizing: "border-box", transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.background = C.blueLight; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surfaceAlt; }}>
                  <span style={{ fontSize: 28 }}>📷</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Foto maken</span>
                  <span style={{ fontSize: 11, color: C.sub }}>Camera openen</span>
                  <input type="file" accept="image/*" capture="environment" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} />
                </label>
                <label style={{
                  background: C.surfaceAlt, border: `1.5px dashed ${C.border}`,
                  borderRadius: 12, padding: "22px 10px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  boxSizing: "border-box", transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.background = C.blueLight; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surfaceAlt; }}>
                  <span style={{ fontSize: 28 }}>🖼️</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Galerij</span>
                  <span style={{ fontSize: 11, color: C.sub }}>Kies een screenshot</span>
                  <input type="file" accept="image/*" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} />
                </label>
              </div>
            )}
          </Field>

          <ErrorBox msg={error} />
          <PrimaryBtn full onClick={submit}>Inleveren →</PrimaryBtn>
        </Card>
      </div>
    </div>
  );
}

// ─── Admin Login ──────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  const [secret,  setSecret]  = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(""); setLoading(true);
    const res = await fetch("/api/admin-get-teachers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: secret }),
    });
    setLoading(false);
    if (!res.ok) return setError("Onjuist beheerderswachtwoord.");
    onLogin(secret);
  };

  return (
    <div style={{ flex:1, background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ width:"100%", maxWidth:380 }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ width:56, height:56, borderRadius:16, background:"#1e293b", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, margin:"0 auto 14px" }}>🔐</div>
          <div style={{ fontWeight:700, fontSize:22, color:C.text }}>Beheerder inloggen</div>
          <div style={{ fontSize:13, color:C.sub, marginTop:4 }}>Alleen toegankelijk voor beheerders</div>
        </div>
        <Card style={{ padding:"22px 20px" }}>
          <Field label="Beheerderswachtwoord">
            <input type="password" value={secret} onChange={e => setSecret(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="Voer het beheerderswachtwoord in"
              style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"11px 14px", fontSize:15, fontFamily:"inherit", color:C.text, outline:"none", background:C.surface, boxSizing:"border-box" }}
              onFocus={e => { e.target.style.borderColor=C.blue; e.target.style.boxShadow=`0 0 0 3px ${C.blueLight}`; }}
              onBlur={e => { e.target.style.borderColor=C.border; e.target.style.boxShadow="none"; }}
            />
          </Field>
          <ErrorBox msg={error} />
          <PrimaryBtn full disabled={loading} onClick={submit}>
            {loading ? "Controleren…" : "Inloggen →"}
          </PrimaryBtn>
        </Card>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function AdminView({ onBack }) {
  const [adminSecret, setAdminSecret] = useState(null);
  const [teachers,    setTeachers]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [toast,       setToast]       = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null); // teacher object to confirm delete
  const [tab,         setTab]         = useState("pending"); // pending | all

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadTeachers = async (secret) => {
    setLoading(true);
    const res = await fetch("/api/admin-get-teachers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: secret }),
    });
    const data = await res.json();
    setTeachers(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const handleLogin = (secret) => {
    setAdminSecret(secret);
    loadTeachers(secret);
  };

  const doAction = async (action, teacher) => {
    if (action === "delete") {
      setConfirmDel(teacher);
      return;
    }
    const res = await fetch("/api/admin-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret, action, teacherId: teacher.id }),
    });
    const data = await res.json();
    if (!res.ok) return showToast("Actie mislukt: " + data.error, "error");
    const emailMsg = data.emailStatus === "failed" ? " (e-mail kon niet worden verstuurd)" : "";
    showToast(action === "approve" ? `✅ ${teacher.name} goedgekeurd${emailMsg}` : `❌ ${teacher.name} afgekeurd${emailMsg}`, action === "approve" ? "ok" : "warn");
    loadTeachers(adminSecret);
  };

  const confirmDelete = async () => {
    const teacher = confirmDel;
    setConfirmDel(null);
    const res = await fetch("/api/admin-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret, action: "delete", teacherId: teacher.id }),
    });
    if (!res.ok) return showToast("Verwijderen mislukt", "error");
    showToast(`🗑️ ${teacher.name} verwijderd`);
    loadTeachers(adminSecret);
  };

  if (!adminSecret) return <AdminLogin onLogin={handleLogin} />;

  const pending = teachers.filter(t => t.status === "pending")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const all = [...teachers].sort((a, b) => a.name.localeCompare(b.name, "nl"));

  const statusBadge = (s) => {
    const map = { pending: ["#FEF9C3","#92400e","In behandeling"], active: [C.greenLight, C.green, "Actief"], rejected: [C.redLight, C.red, "Afgekeurd"] };
    const [bg, col, label] = map[s] || [C.border, C.sub, s];
    return <span style={{ background:bg, color:col, borderRadius:99, padding:"2px 10px", fontSize:11, fontWeight:600 }}>{label}</span>;
  };

  const emailBadge = (s) => {
    if (!s) return null;
    return <span style={{ background: s === "sent" ? C.greenLight : C.redLight, color: s === "sent" ? C.green : C.red, borderRadius:99, padding:"2px 8px", fontSize:10, fontWeight:600 }}>{s === "sent" ? "✓ Verstuurd" : "✗ Mislukt"}</span>;
  };

  return (
    <div style={{ flex:1, overflowY:"auto", background:C.bg, padding:24 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", top:16, right:16, zIndex:2000,
          background: toast.type === "error" ? C.redLight : toast.type === "warn" ? "#FEF9C3" : C.greenLight,
          color: toast.type === "error" ? C.red : toast.type === "warn" ? "#92400e" : C.green,
          border:`1.5px solid ${toast.type === "error" ? C.red : toast.type === "warn" ? "#FDE047" : C.green}`,
          borderRadius:10, padding:"12px 18px", fontSize:14, fontWeight:500,
          boxShadow:"0 4px 16px rgba(15,21,35,0.12)", maxWidth:340,
        }}>{toast.msg}</div>
      )}

      {/* Confirm delete modal */}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(15,21,35,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:C.surface, borderRadius:16, padding:"24px 22px", maxWidth:380, width:"100%", boxShadow:"0 8px 32px rgba(15,21,35,0.15)" }}>
            <div style={{ fontWeight:700, fontSize:17, color:C.text, marginBottom:8 }}>Account verwijderen</div>
            <p style={{ fontSize:14, color:C.sub, lineHeight:1.6, marginBottom:20 }}>
              Weet je zeker dat je het account van <strong style={{ color:C.text }}>{confirmDel.name}</strong> ({confirmDel.email}) wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
            </p>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={confirmDelete} style={{ flex:1, background:C.red, color:C.white, border:"none", borderRadius:8, padding:"10px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Definitief verwijderen</button>
              <button onClick={() => setConfirmDel(null)} style={{ flex:1, background:"transparent", border:`1.5px solid ${C.border}`, borderRadius:8, padding:"10px", fontSize:13, cursor:"pointer", color:C.sub }}>Annuleer</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <div>
            <h2 style={{ margin:"0 0 4px", fontSize:24, fontWeight:700, color:C.text }}>Beheerderspanel</h2>
            <div style={{ fontSize:13, color:C.sub }}>Beheer docentaccounts en aanvragen</div>
          </div>
          <GhostBtn onClick={onBack}>← Terug</GhostBtn>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:4, marginBottom:20, background:C.surface, borderRadius:10, padding:4, border:`1px solid ${C.border}`, width:"fit-content" }}>
          {[["pending", `⏳ Aanvragen (${pending.length})`], ["all", `👥 Alle accounts (${all.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding:"7px 18px", borderRadius:8, border:"none",
              background: tab === key ? C.ink : "transparent",
              color: tab === key ? C.white : C.sub,
              fontWeight: tab === key ? 600 : 400,
              fontSize:13, cursor:"pointer", transition:"all 0.15s",
            }}>{label}</button>
          ))}
        </div>

        {loading ? <Spinner label="Accounts laden…" /> : tab === "pending" ? (
          /* ── Pending aanvragen ── */
          pending.length === 0 ? (
            <Card style={{ padding:"40px 24px", textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:10 }}>✅</div>
              <div style={{ fontWeight:600, fontSize:16, color:C.text }}>Geen openstaande aanvragen</div>
              <div style={{ fontSize:13, color:C.sub, marginTop:4 }}>Alle aanvragen zijn verwerkt.</div>
            </Card>
          ) : pending.map(t => (
            <Card key={t.id} style={{ marginBottom:10, padding:"16px 18px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:38, height:38, borderRadius:99, background:C.blueLight, color:C.blue, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:15, flexShrink:0 }}>
                    {t.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:14, color:C.text }}>{t.name}</div>
                    <div style={{ fontSize:12, color:C.sub }}>{t.email}</div>
                    <div style={{ fontSize:11, color:C.sub, marginTop:2 }}>
                      Aangevraagd op {new Date(t.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" })}
                      {t.email_status && <span style={{ marginLeft:8 }}>{emailBadge(t.email_status)}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                  <button onClick={() => doAction("approve", t)} style={{ background:C.greenLight, color:C.green, border:`1.5px solid ${C.green}`, borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>✓ Goedkeuren</button>
                  <button onClick={() => doAction("reject", t)} style={{ background:"#FEF9C3", color:"#92400e", border:"1.5px solid #FDE047", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>✗ Afkeuren</button>
                  <button onClick={() => doAction("delete", t)} style={{ background:C.redLight, color:C.red, border:`1.5px solid ${C.red}`, borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>🗑 Verwijderen</button>
                </div>
              </div>
            </Card>
          ))
        ) : (
          /* ── Alle accounts ── */
          all.map(t => (
            <Card key={t.id} style={{ marginBottom:8, padding:"14px 18px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:34, height:34, borderRadius:99, background:C.blueLight, color:C.blue, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, flexShrink:0 }}>
                    {t.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:13, color:C.text }}>{t.name}</div>
                    <div style={{ fontSize:12, color:C.sub }}>{t.email}</div>
                    <div style={{ display:"flex", gap:6, marginTop:4, alignItems:"center" }}>
                      {statusBadge(t.status)}
                      <span style={{ fontSize:11, color:C.sub }}>
                        Aangemaakt op {new Date(t.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"short", year:"numeric" })}
                      </span>
                    </div>
                  </div>
                </div>
                <button onClick={() => doAction("delete", t)} style={{ background:C.redLight, color:C.red, border:`1.5px solid ${C.red}`, borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer" }}>🗑 Verwijderen</button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Logo header ──────────────────────────────────────────────────────────────
function Logo({ right }) {
  return (
    <header style={{
      background: C.surface, borderBottom: `1px solid ${C.border}`,
      padding: "0 20px", display: "flex", alignItems: "center",
      justifyContent: "space-between", height: 56, flexShrink: 0,
      boxShadow: "0 1px 3px rgba(15,21,35,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: `linear-gradient(135deg,${C.blue},${C.blueDark})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, boxShadow: "0 2px 6px rgba(59,111,240,0.3)",
        }}>📰</div>
        <span style={{ fontWeight: 700, fontSize: 17, color: C.text, letterSpacing: -0.3 }}>NieuwsKlas</span>
      </div>
      {right}
    </header>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────
function Landing({ onGo }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 32, background: C.bg }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: `linear-gradient(135deg,${C.blue},${C.blueDark})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 34, boxShadow: "0 4px 16px rgba(59,111,240,0.3)",
      }}>📰</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 26, color: C.text, marginBottom: 8 }}>Welkom bij NieuwsKlas</div>
        <div style={{ fontSize: 15, color: C.sub, maxWidth: 340 }}>Kies hieronder hoe je wilt doorgaan.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 320 }}>
        <button onClick={() => onGo("teacher")} style={{
          background: `linear-gradient(135deg,${C.blue},${C.blueDark})`,
          color: C.white, border: "none", borderRadius: 12,
          padding: "16px 24px", fontSize: 16, fontWeight: 600, cursor: "pointer",
          boxShadow: "0 2px 10px rgba(59,111,240,0.3)", textAlign: "left",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>👨‍🏫</span>
          <div>
            <div>Ik ben een docent</div>
            <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.8, marginTop: 2 }}>Klassen beheren & inleveringen bekijken</div>
          </div>
        </button>
        <button onClick={() => onGo("student")} style={{
          background: C.surface, color: C.text,
          border: `1.5px solid ${C.border}`, borderRadius: 12,
          padding: "16px 24px", fontSize: 16, fontWeight: 600, cursor: "pointer",
          textAlign: "left", display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 1px 4px rgba(15,21,35,0.06)",
        }}>
          <span style={{ fontSize: 24 }}>🎒</span>
          <div>
            <div>Ik ben een leerling</div>
            <div style={{ fontSize: 12, fontWeight: 400, color: C.sub, marginTop: 2 }}>Nieuws inleveren met klascode</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────
export default function App() {
  const getPage = () => {
    try {
      const p = new URLSearchParams(window.location.search).get("page");
      if (p === "teacher" || p === "student" || p === "admin") return p;
    } catch {}
    return "landing";
  };

  const [page, setPage] = useState(getPage);

  const navigate = (p) => {
    try {
      const url = new URL(window.location.href);
      if (p === "landing") url.searchParams.delete("page");
      else url.searchParams.set("page", p);
      window.history.pushState({}, "", url);
    } catch {}
    setPage(p);
  };

  const shell = (header, content) => (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif", color: C.text, display: "flex", flexDirection: "column" }}>
      {header}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {content}
      </div>
      <style>{`* { box-sizing: border-box; } body { margin: 0; } ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 99px; }`}</style>
    </div>
  );

  if (page === "admin") return shell(
    <Logo right={<GhostBtn onClick={() => navigate("landing")} style={{ fontSize: 12 }}>← Startpagina</GhostBtn>} />,
    <AdminView onBack={() => navigate("landing")} />
  );

  if (page === "teacher") return shell(
    <Logo right={<GhostBtn onClick={() => navigate("landing")} style={{ fontSize: 12 }}>← Startpagina</GhostBtn>} />,
    <TeacherAuthGate onBack={() => navigate("landing")} />
  );

  if (page === "student") return shell(
    <Logo />,
    <StudentView />
  );

  return shell(<Logo />, <Landing onGo={navigate} />);
}
