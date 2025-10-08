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
const MODEL = "gpt-4.1-mini";

app.post("/chat", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];

    // keep it light: ignore any system msgs sent by browser, keep last 8 turns
    const trimmed = incoming.filter(m => m && m.role !== "system").slice(-8);

    // small helper: retry once on 429/5xx
async function askOnce() {
  const t0 = Date.now(); // start timer

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.5,
    max_tokens: 220, // ✅ cap reply length so it finishes faster
    messages: [
      {
        role: "system",
        content:
          "You are Oclaria's assistant. Reply concisely in FR/Darija/EN. Prices: wall hooks 80 MAD; earbuds 320 MAD; can openers 40–150 MAD; figurines 25–30 MAD. Delivery: Casablanca 20 MAD; others 35 MAD.",
      },
      ...trimmed.slice(-6), // ✅ keep only last 6 messages
    ],
  });

  console.log("OpenAI latency:", Date.now() - t0, "ms"); // measure speed
  return response;
}


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
