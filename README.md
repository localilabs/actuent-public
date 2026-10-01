# Actuent: give your AI the live internet

Ask Claude *"what's open near me right now?"*, *"what concerts are on in New York this weekend?"* or *"what's the cheapest Hoka Clifton right now?"*, and with Actuent connected it actually knows. It doesn't guess, and it doesn't say "I can't browse the internet."

Actuent is a search engine built for AI assistants. It reads websites, shops, venues and maps and hands your AI clean, current answers: opening hours, prices, events and what a company actually offers, each with a link to the source.

**Connect it in 30 seconds:** [docs.actuent.ai/connect](https://docs.actuent.ai/connect) (Claude, ChatGPT, Cursor, VS Code, Claude Code). It's free, and you don't need an account.

## Try these first

Questions your AI can't answer well on its own:

- "What's open near me right now?"
- "What concerts are on in New York this weekend?"
- "What's the cheapest Nike Pegasus right now?"
- "Does Notion have a free plan?"
- "Compare Notion vs Obsidian"

## "Isn't this just MCP?"

MCP is the plug. Actuent is what comes through it.

MCP (Model Context Protocol) is the standard way for Claude, ChatGPT and Cursor to use tools, but a plug with nothing behind it does nothing. Actuent is an MCP server with a search index behind it: about 95,000 websites, millions of products with prices, thousands of upcoming events, and places with opening hours, kept fresh every day.

## For builders

**MCP server**

```
https://agents.actuent.ai/api/mcp
```

```bash
claude mcp add --transport http actuent https://agents.actuent.ai/api/mcp
```

**Search API** (no key needed for the free tier)

```bash
curl "https://api.actuent.ai/api/search?q=cafes+in+brooklyn+open+now"
```

Every result comes back as structured JSON: the site, what it offers, what you can do there (book, buy, call, get directions), opening hours, prices and a match score explaining why it matched. Full reference: [docs.actuent.ai](https://docs.actuent.ai). SDKs: `npm i @actuent/sdk` · `pip install actuent`.

**Make your own site AI-ready:** check it at [docs.actuent.ai/checklist](https://docs.actuent.ai/checklist).

## LAWP, the format underneath

Every website in Actuent is described in **LAWP**, an open JSON format for what a site is, what's on its pages and which actions an AI can take there. Sites can publish their own at `/.well-known/lawp.json`, and Actuent reads it first. Spec: [github.com/localilabs/lawp](https://github.com/localilabs/lawp).

---

Made in Copenhagen by [localilabs](https://actuent.ai). Lawpy the explorer says hi. 👋
