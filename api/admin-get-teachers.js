const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { adminSecret } = req.body;

  if (!adminSecret || adminSecret !== ADMIN_SECRET) {
    return res.status(403).json({ error: "Geen toegang" });
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/teachers?order=created_at.desc&select=id,name,email,role,status,created_at,approved_at,rejected_at,email_status`,
    { headers }
  );

  const data = await response.json();
  return res.status(200).json(data);
}
