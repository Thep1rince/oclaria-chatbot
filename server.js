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
    const { messages } = req.body;

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are Oclaria's assistant. Reply concisely in the visitor's language (FR, Darija, or EN). Prices: wall hooks 80 MAD, earbuds 222 MAD, can openers 40–150 MAD, figurines 25 MAD. Delivery Casablanca 20 MAD, others 30–45 MAD.",
        },
        ...messages,
      ],
    });

    res.json({ reply: response.choices[0].message });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () =>
  console.log(`✅ Oclaria chatbot running on http://localhost:${PORT}`)
);
