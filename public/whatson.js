/*
 * Actuent "what's on" widget — https://docs.actuent.ai/#whatson
 * <script src="https://api.actuent.ai/whatson.js" data-city="Copenhagen" async></script>
 * Or data-venue="yourvenue.com" for one venue's own events. Optional: data-days="14", data-theme="light".
 * Events that venues publish on their own websites, from Actuent.
 */
(function () {
  var script = document.currentScript
  if (!script) return
  var city = script.getAttribute("data-city") || "", venue = script.getAttribute("data-venue") || ""
  var days = script.getAttribute("data-days") || "7", light = script.getAttribute("data-theme") === "light"
  var host = document.createElement("span")
  script.parentNode.insertBefore(host, script)
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  var style = el("style", null, ":host{all:initial}.box{font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;border-radius:12px;padding:14px;box-sizing:border-box;" +
    (light ? "background:#fff;color:#16161d;border:1px solid #e3e3ea" : "background:#0a0a0a;color:#f5f5f7;border:1px solid #2a2a34") + "}" +
    "h4{margin:0 0 8px;font-size:15px}.ev{display:flex;gap:10px;padding:6px 0;border-top:1px solid " + (light ? "#eee" : "#1f1f28") + "}.when{min-width:78px;font-size:12px;opacity:.75}" +
    "a{color:" + (light ? "#16161d" : "#f5f5f7") + ";text-decoration:none;font-weight:600}a:hover{color:#ff8a3d}.small{font-size:11px;opacity:.65}.foot{margin-top:8px;font-size:11px;opacity:.6}.foot a{color:#ff8a3d;font-weight:400}")
  var box = el("div", "box")
  box.appendChild(el("h4", null, venue ? "Coming up" : "What's on" + (city ? " in " + city : "")))
  var list = el("div", null, "Loading…")
  box.appendChild(list)
  var foot = el("div", "foot"); foot.appendChild(document.createTextNode("Events from venues' own websites · ")); var a = el("a", null, "Actuent"); a.href = "https://actuent.ai"; a.target = "_blank"; foot.appendChild(a)
  box.appendChild(foot)
  root.appendChild(style); root.appendChild(box)
  var url = "https://api.actuent.ai/api/events?days=" + encodeURIComponent(days) + (venue ? "&venue=" + encodeURIComponent(venue) : "&city=" + encodeURIComponent(city))
  fetch(url).then(function (r) { return r.json() }).then(function (d) {
    list.textContent = ""
    if (!d.events || !d.events.length) { list.textContent = "Nothing listed yet."; return }
    d.events.slice(0, 12).forEach(function (e) {
      var row = el("div", "ev"), when = el("div", "when", e.day + " " + e.starts), what = el("div")
      var link = el("a", null, e.name); link.href = e.url; link.target = "_blank"; link.rel = "noopener"
      what.appendChild(link); what.appendChild(el("div", "small", [e.venue, e.domain].filter(Boolean).join(" · ")))
      row.appendChild(when); row.appendChild(what); list.appendChild(row)
    })
  }).catch(function () { list.textContent = "Couldn't load events." })
})()
