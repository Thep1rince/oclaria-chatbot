import OpenAI from "openai";
import "dotenv/config";

const key = (process.env.OPENAI_API_KEY || "").trim();
console.log("Key len:", key.length, "starts:", key.slice(0, 14));

try {
  const client = new OpenAI({ apiKey: key });
  const models = await client.models.list();
  console.log("OK ✅ models:", models.data?.length);
} catch (e) {
  console.error("❌ Key test failed:", e.status, e.code, e.message);
}
