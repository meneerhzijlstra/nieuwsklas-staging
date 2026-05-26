export default async function handler(req, res) {
  // Vercel roept deze functie aan via de cron job
  // Extra beveiliging: controleer de Vercel cron header
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Niet geautoriseerd" });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    // Haal alle pending aanvragen op
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/teachers?status=eq.pending&select=id,name,email,created_at`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    const pending = await response.json();

    if (!Array.isArray(pending) || pending.length === 0) {
      console.log("Geen openstaande aanvragen — geen e-mail verstuurd");
      return res.status(200).json({ ok: true, sent: false, message: "Geen openstaande aanvragen" });
    }

    // Stuur e-mail via SMTP
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

    const aantalAanvragen = pending.length;
    const aanvragenLijst = pending
      .map((t, i) => {
        const datum = new Date(t.created_at).toLocaleDateString("nl-NL", {
          day: "numeric", month: "long", year: "numeric",
        });
        return `${i + 1}. ${t.name} (${t.email}) — aangevraagd op ${datum}`;
      })
      .join("\n");

    const appUrl = process.env.APP_URL || "https://nieuwsklas.vercel.app";

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.SMTP_USER,
      subject: `NieuwsKlas — ${aantalAanvragen} openstaande aanvraag${aantalAanvragen !== 1 ? "en" : ""}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <h2 style="color:#0f1523;margin-bottom:8px;">
            📋 ${aantalAanvragen} openstaande aanvraag${aantalAanvragen !== 1 ? "en" : ""}
          </h2>
          <p style="color:#6b7a99;line-height:1.6;">
            Er ${aantalAanvragen === 1 ? "is" : "zijn"} momenteel 
            <strong>${aantalAanvragen} docentaanvraag${aantalAanvragen !== 1 ? "en" : ""}</strong> 
            die wachten op jouw goedkeuring.
          </p>
          <div style="background:#f7f9ff;border:1px solid #e2e8f4;border-radius:10px;padding:16px 18px;margin:16px 0;">
            <pre style="margin:0;font-family:sans-serif;font-size:14px;color:#0f1523;line-height:1.8;">${aanvragenLijst}</pre>
          </div>
          <a href="${appUrl}?page=admin" 
             style="display:inline-block;margin-top:8px;background:#3b6ff0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Naar het beheerderspanel →
          </a>
          <p style="color:#6b7a99;font-size:12px;margin-top:24px;">
            Dit is een automatisch bericht van NieuwsKlas, verstuurd om 21:00.
          </p>
        </div>
      `,
    });

    console.log(`E-mail verstuurd: ${aantalAanvragen} openstaande aanvragen`);
    return res.status(200).json({ ok: true, sent: true, count: aantalAanvragen });

  } catch (err) {
    console.error("Cron fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
