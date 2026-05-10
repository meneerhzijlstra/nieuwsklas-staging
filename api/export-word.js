const {
  Document, Packer, Paragraph, TextRun,
  HeadingLevel, AlignmentType, LevelFormat,
  BorderStyle,
} = require("docx");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { klasnaam, vragen, datum } = req.body;

    // vragen = array van { artikelTitel, vraag, opties: string[], correct: number }
    if (!vragen || vragen.length === 0) {
      return res.status(400).json({ error: "Geen vragen meegestuurd" });
    }

    const vandaag = datum || new Date().toLocaleDateString("nl-NL", {
      day: "numeric", month: "long", year: "numeric"
    });

    const children = [];

    // ── Titel ──
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `Toetsvragen — ${klasnaam}`, bold: true, size: 36 })],
        spacing: { after: 120 },
      })
    );

    // ── Datum ──
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Datum: ${vandaag}`, color: "666666", size: 22 })],
        spacing: { after: 400 },
      })
    );

    // ── Scheidingslijn ──
    children.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "3B6FF0", space: 1 } },
        spacing: { after: 400 },
        children: [],
      })
    );

    // ── Vragen ──
    vragen.forEach((v, index) => {
      // Artikeltitel als context (klein, grijs)
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Artikel: ${v.artikelTitel}`, color: "888888", size: 18, italics: true })],
          spacing: { before: index === 0 ? 0 : 320, after: 80 },
        })
      );

      // Vraagnummer en tekst
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${index + 1}.  ${v.vraag}`, bold: true, size: 24 })],
          spacing: { after: 120 },
        })
      );

      // Antwoordopties (A t/m D)
      v.opties.forEach((optie) => {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `       ${optie}`, size: 22 })],
            spacing: { after: 80 },
          })
        );
      });

      // Lege ruimte tussen vragen
      children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    });

    // ── Document aanmaken ──
    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: "Arial", size: 24 } },
        },
        paragraphStyles: [
          {
            id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
            run: { size: 36, bold: true, font: "Arial", color: "0F1523" },
            paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
          },
        ],
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);

    const bestandsnaam = `Toetsvragen_${klasnaam.replace(/\s+/g, "_")}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${bestandsnaam}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.status(200).send(buffer);

  } catch (err) {
    console.error("Word export fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
