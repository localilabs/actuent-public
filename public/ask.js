// "Ask this site", an embeddable widget: visitors ask a question and get the answer from the
// site's own pages (what Actuent has indexed), with a link to each source page. No AI, no cookies,
// nothing stored. Lawpy is the button.
//
//   <script src="https://api.actuent.ai/ask.js" data-domain="yoursite.com" async></script>
//
// Options (data-…): domain (defaults to the page's own), position ("right" or "left"),
// title ("Ask us anything"), placeholder.
(function () {
  var me = document.currentScript || document.querySelector('script[src*="api.actuent.ai/ask.js"]')
  if (!me || window.__actuentAsk) return
  window.__actuentAsk = true
  var API = "https://api.actuent.ai"
  var domain = (me.getAttribute("data-domain") || location.hostname).toLowerCase().replace(/^www\./, "")
  var side = me.getAttribute("data-position") === "left" ? "left" : "right"
  var title = me.getAttribute("data-title") || "Ask us anything"
  var placeholder = me.getAttribute("data-placeholder") || "e.g. Are you open on Sundays?"

  // Lawpy, the Actuent mascot, is the button.
  var lawpy = document.createElement("script")
  lawpy.src = API + "/assets/lawpy.js"
  lawpy.defer = true
  document.head.appendChild(lawpy)

  var host = document.createElement("div")
  host.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000"
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host
  root.innerHTML =
    '<style>' +
    ':host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.btn{display:flex;align-items:center;gap:8px;background:#13131a;border:1px solid #2a2a34;color:#f5f5f7;border-radius:999px;padding:6px 14px 6px 8px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:14px}' +
    '.btn:hover{border-color:#ff8a3d}' +
    '.panel{display:none;position:absolute;bottom:62px;' + side + ':0;width:min(360px,calc(100vw - 40px));background:#13131a;color:#f5f5f7;border:1px solid #2a2a34;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden}' +
    '.open .panel{display:block}' +
    '.head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #2a2a34;font-weight:600;font-size:15px}' +
    '.head button{margin-left:auto;background:none;border:none;color:#a8a8b6;font-size:20px;cursor:pointer;line-height:1}' +
    '.body{padding:14px 16px;max-height:340px;overflow:auto;font-size:14px;line-height:1.5}' +
    '.body p{margin:0 0 10px;color:#c4c4cf}.body a{color:#ff8a3d;font-size:12px;text-decoration:none}' +
    '.q{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #2a2a34}' +
    '.q input{flex:1;min-width:0;background:#0a0a0a;border:1px solid #34343f;color:#f5f5f7;padding:10px 12px;border-radius:8px;font-size:14px;outline:none}' +
    '.q input:focus{border-color:#ff8a3d}' +
    '.q button{background:#ff8a3d;color:#0a0a0a;border:none;border-radius:8px;padding:0 14px;font-weight:700;cursor:pointer}' +
    '.foot{padding:0 16px 10px;font-size:11px;color:#8e8e9c}.foot a{color:#8e8e9c}' +
    '.muted{color:#8e8e9c}.quote{border-left:2px solid #ff8a3d;padding-left:10px;margin-bottom:10px}' +
    '</style>' +
    '<div class="wrap">' +
    '<div class="panel" role="dialog" aria-label="' + esc(title) + '">' +
    '<div class="head"><lawpy-mascot state="wave" loops="2" then="idle" scale="2"></lawpy-mascot><span>' + esc(title) + '</span><button class="x" aria-label="Close">×</button></div>' +
    '<div class="body" aria-live="polite"><p class="muted">Ask a question and I\'ll look through ' + esc(domain) + '\'s pages for the answer.</p></div>' +
    '<form class="q"><input name="q" placeholder="' + esc(placeholder) + '" maxlength="200" autocomplete="off" aria-label="Your question"><button type="submit">Ask</button></form>' +
    '<div class="foot">Answers come from this site\'s own pages · <a href="https://actuent.ai" target="_blank" rel="noopener">Actuent</a></div>' +
    '</div>' +
    '<button class="btn" aria-expanded="false"><lawpy-mascot state="idle" scale="2"></lawpy-mascot><span>' + esc(title) + '</span></button>' +
    '</div>'
  document.body ? document.body.appendChild(host) : document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(host) })

  var wrap = root.querySelector(".wrap"), body = root.querySelector(".body"), btn = root.querySelector(".btn")
  var headLawpy = root.querySelector(".head lawpy-mascot")
  function toggle(open) {
    wrap.classList.toggle("open", open)
    btn.setAttribute("aria-expanded", String(open))
    if (open) { if (headLawpy.play) headLawpy.play("wave", { loops: 2, then: "idle" }); root.querySelector("input").focus() }
  }
  btn.addEventListener("click", function () { toggle(!wrap.classList.contains("open")) })
  root.querySelector(".x").addEventListener("click", function () { toggle(false) })
  root.querySelector("form").addEventListener("submit", function (e) {
    e.preventDefault()
    var input = root.querySelector("input"), q = input.value.trim()
    if (!q) return
    if (headLawpy.play) headLawpy.play("think")
    body.innerHTML = '<p class="muted">Looking…</p>'
    fetch(API + "/api/ask?domain=" + encodeURIComponent(domain) + "&q=" + encodeURIComponent(q))
      .then(function (r) { return r.json() })
      .then(function (d) {
        var found = (d.sentences || []).length
        if (headLawpy.play) headLawpy.play(found ? "talk" : "idle", found ? { loops: 3, then: "idle" } : {})
        body.innerHTML = '<p><strong>' + esc(q) + '</strong></p>' + (found
          ? d.sentences.map(function (s) { return '<p class="quote">' + esc(s.text) + ' <a href="' + safe(s.url) + '" target="_blank" rel="noopener">source</a></p>' }).join("")
          : '<p class="muted">' + esc(d.message || "I couldn't find that on this site's pages. Try other words.") + '</p>') +
          (d.actions || []).map(function (a) { return a.url ? '<p><a href="' + safe(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + ' →</a></p>' : "" }).join("")
      })
      .catch(function () { if (headLawpy.play) headLawpy.play("idle"); body.innerHTML = '<p class="muted">Couldn\'t reach Actuent right now. Please try again.</p>' })
  })

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] }) }
  function safe(u) { return /^https?:\/\//i.test(String(u || "")) ? esc(u) : "#" }
})()
