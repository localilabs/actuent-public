// Removes website boilerplate from page text: cookie banners, consent prompts, skip links, menu and
// account chrome, newsletter pop-ups and copyright lines. Agents read page text as content, so
// "We'd like to use cookies… No, thanks Yes, that's fine" shouldn't be the first thing they see.
// Shared by actuent-crawler (boilerplate.ts) and actuent-public (src/utils/boilerplate.ts) — copied, keep in sync.

const SENTENCE_NOISE = [
  /\b(use|using|uses|set|sets|store|stores|place|places)( of)? cookies\b/i,
  /^[A-Za-z]{2,12}[.!]?$/,
  /\bcookies?\b.*\b(use|accept|consent|settings|preferences|policy|partners|improve|experience|personali[sz]e|analytics|advertis)/i,
  /\b(accept|reject|decline|allow) (all|cookies|necessary|essential)\b/i,
  /\b(manage|customi[sz]e) (your )?(cookie|privacy|consent) (settings|preferences|choices)\b/i,
  /\bwe (and our partners )?(use|store|process) (cookies|personal data|data)\b/i,
  /\byour privacy (choices|is important)\b/i,
  /^(no,? thanks|yes,? that'?s fine|ok(ay)?,? got it|got it|accept|dismiss|close)\.?$/i,
  /\bskip to (main )?content\b/i,
  /\b(toggle|open|close) (navigation|menu)\b/i,
  /\bsubscribe to our newsletter\b|\bsign up for our newsletter\b/i,
  /^(©|copyright)\s?\d{4}|all rights reserved/i,
  /\bthis site is protected by recaptcha\b/i,
  /\byou (need to|must) enable javascript\b|\bplease enable javascript\b/i,
  /\byour browser (is|does not)\b.*\b(support|outdated)/i
]

// Consent-banner buttons, which scraping glues onto the next real sentence.
const BUTTONS = /\b(no,? thanks|yes,? that[’']?s fine|(accept|reject|allow|decline) all( cookies)?|accept cookies|ok(ay)?,? got it|manage (cookie )?preferences|cookie settings)\b[.!]?/gi

// Jina Reader output saved as-is: its header lines, markdown links/images, bare URLs and markup.
function stripReaderMarkup(text: string): string {
  let t = String(text)
  // Header block, whether still on separate lines or already collapsed onto one.
  if (/^\s*Title:/.test(t) && t.includes("Markdown Content:")) t = t.slice(t.indexOf("Markdown Content:") + 17)
  return t
    .replace(/^(Title|URL Source|Published Time|Warning|Markdown Content):.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)[#*_>`|=-]{1,6}(?=\s|$)/g, " ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
}

export function cleanPageText(text: string): string {
  if (!text) return text
  const original = stripReaderMarkup(text).replace(/\s+/g, " ").trim()
  // Banner buttons only go when the text also has a consent banner, so ordinary uses stay.
  let t = /cookie|consent/i.test(original) ? original.replace(BUTTONS, " ") : original
  // Drop runs of menu words: many short Capitalised tokens without verbs ("Home Shop About Contact Login…").
  t = t.replace(/\b((?:[A-Z][a-z]{1,12} ){6,})(?=[A-Z])/g, m => (m.split(" ").length > 10 ? "" : m)).replace(/\s+/g, " ").trim()
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(©])/)
  const kept = sentences.filter(s => !SENTENCE_NOISE.some(re => re.test(s.trim())))
  const out = kept.join(" ").replace(/\s+/g, " ").trim()
  return out.length >= 20 ? out : original.length >= 20 ? original : String(text).replace(/\s+/g, " ").trim()
}

// True when cleaning changed more than whitespace.
export function changedText(before: string, after: string): boolean {
  return String(before).replace(/\s+/g, " ").trim() !== after
}

// Cleans every page of a LAWP pages object; returns null when nothing changed.
export function cleanPages(pages: Record<string, { title?: string, content?: string }> | null | undefined): Record<string, any> | null {
  if (!pages || typeof pages !== "object") return null
  let changed = false
  const out: Record<string, any> = {}
  for (const [path, page] of Object.entries(pages)) {
    const content = typeof page?.content === "string" ? cleanPageText(page.content) : page?.content
    if (typeof content === "string" && changedText(page!.content!, content)) { changed = true; out[path] = { ...page, content } }
    else out[path] = page
  }
  return changed ? out : null
}
