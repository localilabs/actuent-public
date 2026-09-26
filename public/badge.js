/*
 * Actuent agent-readiness widget — https://docs.actuent.ai/#badge
 * <script src="https://api.actuent.ai/badge.js" data-domain="yoursite.com" async></script>
 * Optional: data-theme="light", or put <div data-actuent-badge="yoursite.com"></div> anywhere and
 * load the script once. Shows your live score out of 100 and links to your Actuent page.
 */
(function () {
  var API = "https://api.actuent.ai/badge.json?domain="
  var script = document.currentScript

  function el(tag, attrs, text) {
    var e = document.createElement(tag)
    for (var k in attrs) e.setAttribute(k, attrs[k])
    if (text != null) e.textContent = text
    return e
  }

  function render(host, domain, theme) {
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host
    var light = theme === "light"
    var css = ":host{all:initial}a{display:inline-flex;gap:12px;align-items:center;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "background:" + (light ? "#ffffff" : "#0a0a0a") + ";color:" + (light ? "#16161d" : "#f5f5f7") + ";border:1px solid " + (light ? "#e3e3ea" : "#2a2a34") + ";border-radius:12px;padding:12px 16px;max-width:360px;box-sizing:border-box}" +
      ".mark{width:34px;height:34px;border-radius:8px;background:#ff8a3d;color:#fff;font:700 20px Georgia,serif;display:flex;align-items:center;justify-content:center;flex:none}" +
      ".score{font:700 26px 'Courier New',monospace;letter-spacing:-1px}.of{font-size:12px;opacity:.6;margin-left:2px}" +
      ".small{font-size:11px;opacity:.7}.label{font-size:12px;font-weight:700}.checks{font-size:11px;opacity:.8;margin-top:2px}"
    root.appendChild(el("style", {}, css))
    var link = el("a", { href: "https://api.actuent.ai/site/" + encodeURIComponent(domain), target: "_blank", rel: "noopener", title: "What AI agents see on " + domain })
    link.appendChild(el("span", { "class": "mark" }, "A"))
    var body = el("span", {})
    body.appendChild(el("div", { "class": "small" }, "Actuent · agent-readiness"))
    var line = el("div", {})
    var score = el("span", { "class": "score" }, "…")
    line.appendChild(score)
    line.appendChild(el("span", { "class": "of" }, "/100"))
    body.appendChild(line)
    var label = el("div", { "class": "label" }, "")
    var checks = el("div", { "class": "checks" }, "")
    body.appendChild(label)
    body.appendChild(checks)
    link.appendChild(body)
    root.appendChild(link)

    fetch(API + encodeURIComponent(domain)).then(function (r) { return r.json() }).then(function (d) {
      if (!d.indexed) { score.textContent = "–"; label.textContent = "Not on Actuent yet"; return }
      var color = d.score >= 80 ? "#16a34a" : d.score >= 45 ? "#ff8a3d" : "#dc2626"
      if (!light && d.score >= 80) color = "#4ade80"
      if (!light && d.score < 45) color = "#f87171"
      score.textContent = d.score
      score.style.color = color
      label.textContent = d.label
      label.style.color = color
      var passed = d.checks.filter(function (c) { return c.ok }).length
      checks.textContent = passed + " of " + d.checks.length + " checks passed"
    }).catch(function () { score.textContent = "–"; label.textContent = "Actuent" })
  }

  var hosts = document.querySelectorAll("[data-actuent-badge]")
  for (var i = 0; i < hosts.length; i++) if (!hosts[i].__actuent) { hosts[i].__actuent = 1; render(hosts[i], hosts[i].getAttribute("data-actuent-badge"), hosts[i].getAttribute("data-theme")) }
  if (script && script.getAttribute("data-domain")) {
    var host = el("span", {})
    script.parentNode.insertBefore(host, script)
    render(host, script.getAttribute("data-domain"), script.getAttribute("data-theme"))
  }
})()
