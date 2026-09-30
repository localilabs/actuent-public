/*
 * Actuent agent-ready checklist widget — https://docs.actuent.ai/checklist
 * <script src="https://api.actuent.ai/checklist.js" data-domain="yoursite.com" async></script>
 * Optional: data-domain left out = a box where visitors type any site (for agencies' own sites);
 * data-platform="shopify|squarespace|wix|webflow|wordpress" links the full steps for that platform;
 * data-theme="light". Checks run when someone clicks (never on page load).
 */
(function () {
  var API = "https://api.actuent.ai/api/checkup?domain="
  var script = document.currentScript
  function el(tag, attrs, text) {
    var e = document.createElement(tag)
    for (var k in attrs || {}) e.setAttribute(k, attrs[k])
    if (text != null) e.textContent = text
    return e
  }
  function render(host, domain, platform, light) {
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host
    var css = ":host{all:initial}.box{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;box-sizing:border-box;border-radius:12px;padding:16px;" +
      (light ? "background:#fff;color:#16161d;border:1px solid #e3e3ea" : "background:#0a0a0a;color:#f5f5f7;border:1px solid #2a2a34") + "}" +
      ".top{display:flex;align-items:center;gap:12px}.lawpy{width:42px;height:33px;flex:none;image-rendering:pixelated;background:url(https://api.actuent.ai/assets/lawpy/idle.svg) no-repeat 0 100%/42px 33px}" +
      ".lawpy.think{width:51px;background:url(https://api.actuent.ai/assets/lawpy/think.svg) no-repeat 0 100%/306px 33px;animation:t 1.5s steps(6) infinite}" +
      ".lawpy.dance{width:54px;height:36px;background:url(https://api.actuent.ai/assets/lawpy/dance.svg?v=2) no-repeat 0 100%/648px 36px;animation:d 1.2s steps(12) infinite}" +
      "@keyframes t{to{background-position:-306px 100%}}@keyframes d{to{background-position:-648px 100%}}@media (prefers-reduced-motion:reduce){.lawpy{animation:none!important}}" +
      "h4{margin:0;font-size:14px}.small{font-size:12px;opacity:.7}.row{display:flex;gap:6px;margin-top:10px}" +
      "input{flex:1;min-width:0;padding:8px 10px;border-radius:7px;font-size:13px;" + (light ? "border:1px solid #d5d5df;background:#fafafa;color:#16161d" : "border:1px solid #34343f;background:#17171f;color:#f5f5f7") + "}" +
      "button{background:#ff8a3d;color:#0a0a0a;border:0;border-radius:7px;padding:8px 12px;font-weight:700;cursor:pointer}button:disabled{opacity:.6}" +
      "ul{list-style:none;padding:0;margin:10px 0 0;font-size:13px;line-height:1.7}.ok{color:" + (light ? "#16a34a" : "#4ade80") + "}.no{color:" + (light ? "#dc2626" : "#f87171") + "}" +
      ".score{font:700 26px 'Courier New',monospace}a{color:#ff8a3d}"
    root.appendChild(el("style", {}, css))
    var box = el("div", { "class": "box" }), top = el("div", { "class": "top" }), lawpy = el("span", { "class": "lawpy", role: "img", "aria-label": "Lawpy" })
    var head = el("div", {}); head.appendChild(el("h4", {}, "Is your site ready for AI agents?")); head.appendChild(el("div", { "class": "small" }, "Free check by Actuent: what ChatGPT, Claude and other assistants can read and do."))
    top.appendChild(lawpy); top.appendChild(head); box.appendChild(top)
    var row = el("div", { "class": "row" }), input = el("input", { placeholder: "yoursite.com", "aria-label": "Website" }), btn = el("button", { type: "button" }, "Check")
    if (domain) input.value = domain
    row.appendChild(input); row.appendChild(btn); box.appendChild(row)
    var out = el("div", {}); box.appendChild(out); root.appendChild(box)
    btn.addEventListener("click", function () {
      var d = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
      if (!d) return
      btn.disabled = true; btn.textContent = "Checking…"; lawpy.className = "lawpy think"; out.textContent = ""
      fetch(API + encodeURIComponent(d)).then(function (r) { return r.json() }).then(function (res) {
        btn.disabled = false; btn.textContent = "Check again"
        if (!res.reachable) { lawpy.className = "lawpy"; out.appendChild(el("p", { "class": "small" }, res.message || res.error || "Couldn't check that site.")); return }
        var todo = res.checks.filter(function (c) { return !c.ok && !c.optional })
        lawpy.className = "lawpy" + (todo.length ? "" : " dance")
        var s = el("p", {}); s.appendChild(el("span", { "class": "score" }, String(res.score))); s.appendChild(document.createTextNode("/100 · " + (todo.length ? todo.length + " to fix" : "all done"))); out.appendChild(s)
        var ul = el("ul", {})
        res.checks.filter(function (c) { return !c.optional || c.ok }).forEach(function (c) { var li = el("li", { "class": c.ok ? "ok" : "no" }, (c.ok ? "✓ " : "○ ") + c.label); ul.appendChild(li) })
        out.appendChild(ul)
        var more = el("a", { href: "https://docs.actuent.ai/checklist?domain=" + encodeURIComponent(d) + (platform ? "&platform=" + encodeURIComponent(platform) : ""), target: "_blank", rel: "noopener" }, "How to fix each one →")
        var p = el("p", { "class": "small" }); p.appendChild(more); out.appendChild(p)
      }).catch(function () { btn.disabled = false; btn.textContent = "Check"; lawpy.className = "lawpy"; out.appendChild(el("p", { "class": "small" }, "Couldn't reach Actuent. Try again.")) })
    })
  }
  if (script) {
    var host = el("span", {})
    script.parentNode.insertBefore(host, script)
    render(host, script.getAttribute("data-domain"), script.getAttribute("data-platform"), script.getAttribute("data-theme") === "light")
  }
})()
