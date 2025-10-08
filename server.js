// ---- Load catalog (JSON single source of truth) ----
import fs from "fs";

let catalog = {};
try {
  catalog = JSON.parse(fs.readFileSync("./data/catalog.json", "utf8"));
  console.log("Catalog loaded with products:", Object.keys(catalog.products || {}));
} catch (e) {
  console.error("Failed to load catalog.json:", e.message);
  catalog = {};
}

// ---- server.js ----
import "dotenv/config";          // load .env first
import express from "express";
import cors from "cors";
import OpenAI from "openai";

// Confirm .env loaded
console.log(
  "Loaded key:",
  process.env.OPENAI_API_KEY?.slice(0, 10),
  "len=",
  process.env.OPENAI_API_KEY?.length
);

const app = express();
app.use(cors());
app.use(express.json());

// quick health check
app.get("/", (req, res) => res.send("Oclaria chatbot is running ✅"));

// Initialize OpenAI client
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

app.post("/chat", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];

    // Keep it light: drop any system msgs from browser, keep last 8 turns (we'll slice to 6 below)
    const trimmed = incoming.filter(m => m && m.role !== "system").slice(-8);

    // Build the personality + data-driven system prompt
    const systemPrompt = `
You are "Oclaria Assistant" — a friendly, confident, conversational virtual salesperson for Oclaria (oclaria.com).

Language:
- Always reply in the user's language: Moroccan Darija (Arabic script) / French / English.

Tone:
- Warm, helpful, slightly playful, but professional. Use light emojis (not too many).

Sales goals:
- Help customers discover, compare, and buy Oclaria products.
- Answer concisely, then add a helpful next step:
  • Link to the correct product page from the catalog.
  • If they want to order, advise contacting us via WhatsApp politely.

Source of truth (do NOT invent prices):
${JSON.stringify(catalog, null, 2)}

Rules:
- Never invent or change prices; rely only on the catalog above.
- Include the relevant product link when asked about an item.
- Mention delivery fees: Casablanca 20 MAD, Marrakech free, other cities 35 MAD.
- Free delivery thresholds: wall hooks ≥120 MAD, can openers ≥150 MAD, earbuds always free everywhere.
- Also suggest: "See all products" at ${catalog.catalog_page || "https://oclaria.com/products"}.
- If the user seems ready to buy, suggest ordering via WhatsApp in a friendly way.
- Keep replies short and clear. If info is missing, say you'll check it 👀.
`.trim();

    // Helper: one call with timing
    async function askOnce() {
      const t0 = Date.now();
      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 220,                // cap for speed
        messages: [
          { role: "system", content: systemPrompt },
          ...trimmed.slice(-6)          // keep only last 6 messages
        ],
      });
      console.log("OpenAI latency:", Date.now() - t0, "ms");
      return response;
    }

    // Retry once on 429/5xx
    let resp;
    try {
      resp = await askOnce();
    } catch (e1) {
      const code = e1?.status || 0;
      if (code === 429 || (code >= 500 && code < 600)) {
        await new Promise(r => setTimeout(r, 900)); // brief backoff
        resp = await askOnce();
      } else {
        throw e1;
      }
    }

    res.json({ reply: resp.choices[0].message });
  } catch (err) {
    console.error("❌ /chat error:", err.status || "", err.code || "", err.message);
    res.status(500).json({ error: err.message || "server_error" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () =>
  console.log(`✅ Oclaria chatbot running on http://localhost:${PORT}`)
);
