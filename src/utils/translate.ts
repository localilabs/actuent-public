import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function detectLanguage(text: string): Promise<string> {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `What language is this text in? Reply with ONLY the ISO 639-1 language code (e.g. 'en', 'da', 'de', 'fr', 'es', 'nl', 'sv', 'no'). Text: ${text.slice(0, 200)}`
      }],
      temperature: 0
    })
    return completion.choices?.[0]?.message?.content?.trim().toLowerCase() || "en"
  } catch {
    return "en"
  }
}

export async function translateToEnglish(text: string, fromLang: string): Promise<string> {
  if (fromLang === "en") return text
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `Translate this ${fromLang} text to plain English. Return ONLY the translation, nothing else:\n\n${text}`
      }],
      temperature: 0.1
    })
    return completion.choices?.[0]?.message?.content?.trim() || text
  } catch {
    return text
  }
}
