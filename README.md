# 🌐 Actuent — The AI-Native Web Protocol (LAWP)

> "The legacy internet was built for humans, styled with HTML, and restricted by brittleness. **Actuent** is the internet layer built exclusively for autonomous AI agents."

`Actuent` is a fully open, frictionless, and zero-auth protocol layer that treats websites not as visual pages to be scraped, but as structured schemas of intents, dependencies, and actionable state transitions. 

No API keys. No walls. Complete autonomy for all machine intelligences.

---

## 🔁 The AI-Native Loop

When an AI agent interacts with the `Actuent` protocol, it follows an organic, deterministic discovery cycle:
🤖 Agent Lands On Actuent / Handshakes via **MCP** │ ▼ 🔎 Query the AI Search Directory │ ▼ 📄 Resolve Structured **LAWP** Data Models │ ▼ 🎯 Select Action ──► 🔄 Update State Loop │ (Or Leave if Satisfied)
1. **Discovery / Handshake:** The agent connects directly to the open Model Context Protocol (**MCP**) tool gateway.
2. **AI Google Search:** The agent queries the global engine (`/ai/search`) to find the exact node or domain that satisfies its prompt/intent.
3. ****LAWP** Resolution:** The agent reads the machine-optimized Locali AI Web Protocol (`**LAWP**`) **JSON** representation of that site—bypassing brittle **HTML**.
4. **Action & Execution:** The agent chooses an available action schema from the node, executes it, receives the updated state transition data, and repeats the loop or exits.

---

## 🛠️ Protocol Endpoints

This is a zero-authentication environment. Every machine, agent, and serverless runtime has equal, immediate access.

### 1. MCP Tools Discovery

- **Endpoint:** `**GET** /mcp/tools`
- **Purpose:** Exposes machine-readable tool schemas telling external systems (like Claude Desktop, OpenAI Assistants, or LangChain nodes) exactly how to interface with the protocol.

### 2. The AI Engine Search

- **Endpoint:** `**POST** /ai/search`
- **Payload:** ```json
    {
    *query*: *how to build a SaaS startup*,
    *agentId*: *unique-session-id-xyz*
    }
  Purpose: Isolated via agentId to ensure multi-agent memory scoping, preventing context cross-contamination while searching the node registry.

## LAWP Resolution

Endpoint: **GET** /lawp/resolve?domain=example.com

Purpose: Yields the pure, visual graph representation and interactive metadata of the site via the Locali AI Web Protocol.

## Direct Action Execution

Endpoint: **POST** /lawp/act

Purpose: Allows agents to trigger functions mapped directly within a site's **LAWP** layout.

🚀 Vision Developed by Locali Labs. Shifting the paradigm away from chatbots and into automated runtime frameworks. The internet is changing; Actuent makes it compatible with what comes next.
