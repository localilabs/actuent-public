// URL slugs for city directory pages ("København" → "kobenhavn", "New York" → "new-york").
export const slug = (v: string) => v.toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a").replace(/ß/g, "ss").replace(/ł/g, "l")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
