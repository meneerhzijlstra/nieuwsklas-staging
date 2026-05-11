export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { samenvatting, vraag, opties } = req.body;

    if (!samenvatting || !vraag) {
      return res.status(400).json({ error: "Samenvatting en vraag zijn verplicht" });
    }

    const prompt = `Je bent een toetsmaker voor middelbare scholieren.

Hieronder staat een samenvatting van een nieuwsartikel, een vraag die erover gesteld wordt, en de antwoordopties.

Samenvatting: "${samenvatting}"
Vraag: "${vraag}"
Antwoordopties: ${opties.join(", ")}

Schrijf een neutrale contextzin van maximaal 2 zinnen die:
- Alleen beschrijft waar het artikel over gaat (bijv. "Het artikel gaat over...")
- GEEN antwoord geeft op de vraag, ook niet indirect
- GEEN specifieke getallen, namen, of details noemt die het antwoord verraden
- Geschikt is als inleiding op de vraag in een toets

Geef ALLEEN de contextzin terug, geen uitleg.`;

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
      }),
    });

    const data = await response.json();
    const tekst = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return res.status(200).json({ context: tekst || null });
  } catch (err) {
    console.error("Herschrijf fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
