import crypto from "crypto";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, fileName } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "Geen afbeelding meegestuurd" });

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    // Genereer signature voor veilige upload
    const timestamp = Math.round(Date.now() / 1000);
    const folder    = "nieuwsklas";
    const publicId  = fileName || `artikel_${timestamp}`;

    const toSign    = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");

    // Upload via Cloudinary REST API
    const formData = new URLSearchParams();
    formData.append("file", `data:image/jpeg;base64,${imageBase64}`);
    formData.append("api_key", apiKey);
    formData.append("timestamp", timestamp);
    formData.append("signature", signature);
    formData.append("folder", folder);
    formData.append("public_id", publicId);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: "POST", body: formData }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("Cloudinary fout:", data);
      return res.status(500).json({ error: data.error?.message || "Upload mislukt" });
    }

    return res.status(200).json({ url: data.secure_url });

  } catch (err) {
    console.error("Upload fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
