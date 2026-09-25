import { ImageResponse } from "@vercel/og"

// Social preview cards (1200×630) for Actuent pages: /og?title=…&subtitle=…&tag=…
// Runs on Vercel's Edge runtime, which @vercel/og is built for.
export const config = { runtime: "edge" }

const h = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } })

export default function handler(req: Request) {
  const q = new URL(req.url).searchParams
  const title = (q.get("title") || "The Internet for AI").slice(0, 90)
  const subtitle = (q.get("subtitle") || "Search engine for AI agents · structured data for any website").slice(0, 140)
  const tag = (q.get("tag") || "actuent.ai").slice(0, 40)

  const card = h("div", { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", background: "#0a0a0a", color: "#f5f5f7", fontFamily: "sans-serif" }, [
    h("div", { display: "flex", alignItems: "center", gap: "20px" }, [
      h("div", { width: "64px", height: "64px", borderRadius: "14px", background: "#ff8a3d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "44px", fontWeight: 700, color: "#fff" }, "A"),
      h("div", { fontSize: "34px", fontWeight: 700 }, "Actuent")
    ]),
    h("div", { display: "flex", flexDirection: "column", gap: "20px" }, [
      h("div", { fontSize: title.length > 40 ? "64px" : "78px", fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.05 }, title),
      h("div", { fontSize: "32px", color: "#c4c4cf", lineHeight: 1.3 }, subtitle)
    ]),
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, [
      h("div", { fontSize: "26px", color: "#ff8a3d", fontWeight: 700 }, tag),
      h("div", { width: "240px", height: "10px", borderRadius: "5px", background: "#ff8a3d" })
    ])
  ])

  return new ImageResponse(card as any, {
    width: 1200, height: 630,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable" }
  })
}
