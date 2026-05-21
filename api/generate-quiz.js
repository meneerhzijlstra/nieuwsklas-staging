export default async function handler(req, res) {
  // Alleen POST toestaan
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // OPTIONS preflight afhandelen
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "Geen afbeelding meegestuurd" });
    }

    const prompt = `Analyseer dit nieuwsartikel screenshot en maak 4 meerkeuzevragen voor middelbare scholieren.

Geef ALLEEN dit JSON (geen markdown, geen uitleg):
{"title":"Korte titel (max 8 woorden)","summary":"Één zin samenvatting","questions":[{"question":"Vraag?","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0}]}

Regels: "correct" = 0-gebaseerde index, varieer het juiste antwoord, test begrip, schrijf Nederlands.`;

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: imageBase64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1000,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini fout:", JSON.stringify(data));
      return res.status(500).json({ error: "Uploaden mislukt", details: data });
    }

    // Tekst uit Gemini response halen
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      console.error("Geen tekst in Gemini response:", JSON.stringify(data));
      return res.status(500).json({ error: "Geen antwoord van AI ontvangen" });
    }

    const clean = text.replace(/```json|```/g, "").trim();
    const quiz = JSON.parse(clean);

    return res.status(200).json({ quiz });
  } catch (err) {
    console.error("Server fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
