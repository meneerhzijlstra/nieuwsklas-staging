const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
};

async function sendEmail(to, subject, html) {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    html,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { adminSecret, action, teacherId } = req.body;

  // Valideer admin secret
  if (!adminSecret || adminSecret !== ADMIN_SECRET) {
    return res.status(403).json({ error: "Geen toegang" });
  }

  if (!teacherId || !action) {
    return res.status(400).json({ error: "teacherId en action zijn verplicht" });
  }

  // Haal docent op
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/teachers?id=eq.${teacherId}&limit=1`,
    { headers }
  );
  const teachers = await getRes.json();
  const teacher = teachers[0];
  if (!teacher) return res.status(404).json({ error: "Docent niet gevonden" });

  // Verwijderen
  if (action === "delete") {
    await fetch(`${SUPABASE_URL}/rest/v1/teachers?id=eq.${teacherId}`, {
      method: "DELETE", headers,
    });
    return res.status(200).json({ ok: true });
  }

  // Goedkeuren of afkeuren
  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ error: "Ongeldige actie" });
  }

  const newStatus = action === "approve" ? "active" : "rejected";
  const now = new Date().toISOString();
  const updateBody = action === "approve"
    ? { status: newStatus, approved_at: now }
    : { status: newStatus, rejected_at: now };

  // Update status in database
  await fetch(`${SUPABASE_URL}/rest/v1/teachers?id=eq.${teacherId}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify(updateBody),
  });

  // Verstuur e-mail (best-effort)
  let emailStatus = "sent";
  const appUrl = process.env.APP_URL || "https://nieuwsklas.vercel.app";

  try {
    if (action === "approve") {
      await sendEmail(
        teacher.email,
        "Je docentaccount is goedgekeurd — NieuwsKlas",
        `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <h2 style="color:#0f1523;margin-bottom:8px;">Je account is goedgekeurd! 🎉</h2>
          <p style="color:#6b7a99;line-height:1.6;">Beste ${teacher.name},</p>
          <p style="color:#6b7a99;line-height:1.6;">
            Je docentaccount voor <strong>NieuwsKlas</strong> is goedgekeurd.
            Je kunt nu inloggen en aan de slag gaan met je klassen.
          </p>
          <a href="${appUrl}?page=teacher" style="display:inline-block;margin-top:16px;background:#3b6ff0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Inloggen →
          </a>
          <p style="color:#6b7a99;font-size:13px;margin-top:24px;">
            Vragen? Neem contact op met de beheerder.
          </p>
        </div>`
      );
    } else {
      await sendEmail(
        teacher.email,
        "Je docentaccount aanvraag is afgekeurd — NieuwsKlas",
        `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <h2 style="color:#0f1523;margin-bottom:8px;">Aanvraag afgekeurd</h2>
          <p style="color:#6b7a99;line-height:1.6;">Beste ${teacher.name},</p>
          <p style="color:#6b7a99;line-height:1.6;">
            Je aanvraag voor een docentaccount bij <strong>NieuwsKlas</strong> is helaas afgekeurd.
          </p>
          <p style="color:#6b7a99;line-height:1.6;">
            Heb je vragen over deze beslissing? Neem dan contact op met de beheerder via
            <a href="mailto:${process.env.MAIL_FROM}">${process.env.MAIL_FROM}</a>.
          </p>
        </div>`
      );
    }
  } catch (err) {
    console.error("E-mail versturen mislukt:", err.message);
    emailStatus = "failed";
  }

  // Sla email status op
  await fetch(`${SUPABASE_URL}/rest/v1/teachers?id=eq.${teacherId}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ email_status: emailStatus }),
  });

  return res.status(200).json({ ok: true, emailStatus });
}
