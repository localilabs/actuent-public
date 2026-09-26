// AI crawlers and assistants, and who they belong to. Copied from actuent-crawler/ai_access.ts — keep in sync.
export const AI_BOTS: Record<string, string> = {
  "GPTBot": "OpenAI (training)", "OAI-SearchBot": "ChatGPT search", "ChatGPT-User": "ChatGPT (browsing for a user)",
  "ClaudeBot": "Anthropic (training)", "Claude-SearchBot": "Claude search", "Claude-User": "Claude (browsing for a user)",
  "PerplexityBot": "Perplexity search", "Perplexity-User": "Perplexity (browsing for a user)",
  "Google-Extended": "Google Gemini (training)", "Applebot-Extended": "Apple Intelligence (training)",
  "Amazonbot": "Amazon / Alexa", "meta-externalagent": "Meta AI", "CCBot": "Common Crawl (used by many AI models)",
  "Bytespider": "ByteDance", "cohere-ai": "Cohere", "DuckAssistBot": "DuckDuckGo AI answers", "MistralAI-User": "Mistral Le Chat",
  "Actuent": "Actuent (this search engine)"
}

// Search and "browsing for a user" bots: blocking these stops AI assistants from using the site for people.
export const USER_FACING = new Set(["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "DuckAssistBot", "MistralAI-User", "Actuent"])
