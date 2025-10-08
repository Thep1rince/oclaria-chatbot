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

// --- delivery rules
const FREE_HOOKS = 120;
const FREE_OPENERS = 150;
const PRICE = {
  hooks30: 80, hooks40: 110, hooks50: 135, hooks60: 150,
  open6: 40, open12: 70, open24: 135, open48: 250,
  earbuds: 320,
};

function detectProductFacts(text="") {
  const t = text.toLowerCase();

  // Earbuds
  if (/(earbud|i121|écouteur|سماعات|m91)/.test(t)) {
    return { key: "earbuds", price: PRICE.earbuds, qualifies: true, threshold: 0, type: "earbuds" };
  }

  // Hooks with quantity
  const mHook = t.match(/(hook|crochet|كروشي).*?(30|40|50|60|٣٠|٤٠|٥٠|٦٠)/);
  if (mHook) {
    const q = mHook[2].replace(/[^\d]/g,'');
    const key = `hooks${q}`;
    const price = PRICE[key];
    return { key, price, qualifies: price >= FREE_HOOKS, threshold: FREE_HOOKS, type: "hooks" };
  }
  if (/(hook|crochet|كروشي)/.test(t)) {
    // no qty -> give generic hooks rule
    return { key: "hooks", price: null, qualifies: null, threshold: FREE_HOOKS, type: "hooks" };
  }

  // Openers with quantity
  const mOp = t.match(/(openers?|ouvre|فتاحات).*?(6|12|24|48|٦|١٢|٢٤|٤٨)/);
  if (mOp) {
    const q = mOp[2].replace(/[^\d]/g,'');
    const key = `open${q}`;
    const price = PRICE[key];
    return { key, price, qualifies: price >= FREE_OPENERS, threshold: FREE_OPENERS, type: "openers" };
  }
  if (/(openers?|ouvre|فتاحات)/.test(t)) {
    return { key: "openers", price: null, qualifies: null, threshold: FREE_OPENERS, type: "openers" };
  }

  return null;
}

function factsMessageFromIntent(msgs) {
  const lastUser = [...msgs].reverse().find(m => m.role === "user")?.content || "";
  const info = detectProductFacts(lastUser);
  if (!info) return null;

  // Construct a concise, **authoritative** system hint
  if (info.type === "earbuds") {
    return `FACTS: Earbuds i121 price is 320 MAD and delivery is always free (no threshold).`;
  }
  if (info.type === "hooks") {
    if (info.price != null) {
      const note = info.qualifies
        ? `This pack qualifies for free delivery (≥ ${FREE_HOOKS} MAD).`
        : `This pack does not reach ${FREE_HOOKS} MAD; customer must add items to qualify for free delivery.`;
      return `FACTS: Wall hooks pack detected: price ${info.price} MAD. ${note}`;
    } else {
      return `FACTS: Wall hooks free delivery threshold is ${FREE_HOOKS} MAD (e.g., 50 pcs = 135 MAD qualifies).`;
    }
  }
  if (info.type === "openers") {
    if (info.price != null) {
      const note = info.qualifies
        ? `This pack qualifies for free delivery (≥ ${FREE_OPENERS} MAD).`
        : `This pack does not reach ${FREE_OPENERS} MAD; customer must add items to qualify for free delivery.`;
      return `FACTS: Can openers pack detected: price ${info.price} MAD. ${note}`;
    } else {
      return `FACTS: Can openers free delivery threshold is ${FREE_OPENERS} MAD (e.g., 48 pcs = 250 MAD qualifies).`;
    }
  }
  return null;
}

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

const facts = factsMessageFromIntent(trimmed);
const sysPrompt = {
  role: "system",
  content: `
You are "Oclaria Assistant" — official virtual salesperson for oclaria.com.
Always follow FACTS messages strictly when present (they override your guesses).
Use client's language (Darija Arabic script / French / English), be concise, human, and sales-friendly.
Never claim a threshold is required if the product price already qualifies.`
};

const messages = [sysPrompt];
if (facts) messages.push({ role: "system", content: facts });

// then include the rest of their conversation:
messages.push(...trimmed.slice(-6));

const response = await client.chat.completions.create({
  model: MODEL,
  temperature: 0.5,
  max_tokens: 220,
  messages
});

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
      if (code === 429) {
        console.warn('⏳ One sec, there are too many requests at the moment. I’ll answer in a few seconds…');
        await new Promise(r => setTimeout(r, 5000));
        resp = await askOnce();
      } else if (code >= 500 && code < 600) {
        await new Promise(r => setTimeout(r, 1200));
        resp = await askOnce();
      } else {
        throw e1;
      }
    }
// --- Fix WhatsApp-style link rendering
let reply = resp.choices[0].message?.content || "";
reply = reply
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1: $2')   // Convert [title](url) → title: url
  .replace(/https:\/\/oclaria\.com\//g, 'https://oclaria.com/'); // clean duplicates just in case
res.json({ reply: { role: "assistant", content: reply } });

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
