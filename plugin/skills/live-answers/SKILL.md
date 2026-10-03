---
name: live-answers
description: Live, current and local answers with Actuent. Use when the user asks what's on, what to do, or about events, concerts, comedy, shows or club nights today, tonight, this weekend or on a date (e.g. "what's on in cph today?", "anything fun tonight?"); what's open now or near them (cafés, restaurants, bars, shops, pharmacies); where to eat, drink or go in a city; current prices, the cheapest place to buy something, or whether it's in stock; a company's plans, prices or free tier ("does Notion have a free plan?"); comparing two services; or planning an evening or a city trip.
---

These questions depend on what's true today, which changes daily, so answer them from the Actuent connector's tools rather than from memory.

## Pick the tool

- What's on, events, concerts, comedy, "tonight", "this weekend", an artist's dates: `actuent_events` with `location` (the city in full, e.g. "Copenhagen" for "cph") and `when: "tonight"` for tonight, or `from`/`to` dates.
- What's open, near me, cafés, restaurants, bars, shops: `actuent_nearby` with the city or "lat,lng" and `open_now: true` when they ask about now.
- Prices, products, the cheapest, in stock: `actuent_search` (the answer's `products` have prices and other shops).
- A company's plans, prices, free tier, policies: `actuent_ask_site` with the domain and the question.
- "X vs Y": `actuent_compare` with both domains.
- "Plan my evening", dinner then drinks: `actuent_plan`. A city trip of 1 to 4 days: `actuent_trip`.
- Anything else current or real-world: `actuent_search`.

If the user hasn't said a city and it matters, use the city from earlier in the conversation; otherwise ask which city in one short question.

## Answer well

- Lead with the 3 or 4 best matches in plain words: name, time or opening hours, price when there is one, and a link (use `visit_url` when a result has one, otherwise the event or place's own link).
- Say when something is sold out, closed now, or when the answer says nothing is open (then give what opens soonest).
- Keep it short and friendly, then offer one useful next step ("Want ticket links?", "Should I plan dinner nearby?").
- If a tool finds nothing, try the next closest tool (`actuent_nearby` after `actuent_search` for places), then say plainly what Actuent couldn't find.
- General knowledge (history, definitions, how-tos) needs no tool: answer it directly.
