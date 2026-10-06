# Actuent for Claude

Live answers from the web, right in Claude: what's on today, what's open now, real prices and what a company actually offers, each with a link to the source.

## Use it

Ask Claude normally. The plugin's skill tells Claude to use Actuent for current and local questions, so you don't have to say "use Actuent":

- "What's on in cph today?"
- "Find me a café in Brooklyn that's open now"
- "What's the cheapest Hoka Clifton right now?"
- "Does Notion have a free plan?"
- "Plan dinner then drinks in Nørrebro tonight"

## After installing: connect Actuent (one step, required)

The plugin brings the skill and the Actuent connector, but the connector has to be switched on once before Claude can use it:

1. **Claude app or Cowork:** Settings → Connectors → **Actuent** → **Connect**.
   **Claude Code:** run `/mcp`, choose **actuent** and authenticate.
2. On Actuent's page, click **"Continue free (no key needed)"**.

If you skip this, Claude will remind you with these steps the first time you ask something live. Step-by-step help: https://docs.actuent.ai/connect

Actuent is free with no account; an optional Actuent Pro plan (€9/month at actuent.ai) adds more results, price alerts and search history.

## Data

The plugin sends the search terms Claude chooses (for example "concerts Copenhagen tonight") to Actuent's server at agents.actuent.ai. Actuent keeps those searches for Pro search history, trending and quality fixes, and uses IP addresses for rate limits. It never receives your conversation. Privacy policy: https://docs.actuent.ai/privacy

Made by localilabs, Copenhagen. Support: support@localilabs.com
