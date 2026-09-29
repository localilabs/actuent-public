/*
 * Actuent agent-readiness widget — https://docs.actuent.ai/#badge
 * <script src="https://api.actuent.ai/badge.js" data-domain="yoursite.com" async></script>
 * Optional: data-theme="light", or put <div data-actuent-badge="yoursite.com"></div> anywhere and
 * load the script once. Shows your live score out of 100 and links to your Actuent page.
 * Lawpy, our mascot, stands beside the score (dancing at 90+); data-lawpy="off" hides him.
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

  function render(host, domain, theme, noLawpy) {
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host
    var light = theme === "light"
    var css = ":host{all:initial}a{display:inline-flex;gap:12px;align-items:center;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "background:" + (light ? "#ffffff" : "#0a0a0a") + ";color:" + (light ? "#16161d" : "#f5f5f7") + ";border:1px solid " + (light ? "#e3e3ea" : "#2a2a34") + ";border-radius:12px;padding:12px 16px;max-width:360px;box-sizing:border-box}" +
      ".mark{width:34px;height:34px;border-radius:8px;background:#ff8a3d;color:#fff;font:700 20px Georgia,serif;display:flex;align-items:center;justify-content:center;flex:none}" +
      ".score{font:700 26px 'Courier New',monospace;letter-spacing:-1px}.of{font-size:12px;opacity:.6;margin-left:2px}" +
      ".small{font-size:11px;opacity:.7}.label{font-size:12px;font-weight:700}.checks{font-size:11px;opacity:.8;margin-top:2px}" +
      // Lawpy: a CSS sprite from the same sheets as the website (3 px per Lawpy pixel).
      ".lawpy{width:54px;height:36px;flex:none;margin-left:auto;background:url(https://api.actuent.ai/assets/lawpy/idle.svg) no-repeat 0 100%/42px 33px;image-rendering:pixelated}" +
      ".lawpy.dance{background-image:url(https://api.actuent.ai/assets/lawpy/dance.svg?v=2);background-size:648px 36px;animation:lp 1.2s steps(12) infinite}" +
      ".lawpy.think{width:51px;background-image:url(https://api.actuent.ai/assets/lawpy/think.svg);background-size:306px 33px;animation:lp4 1.5s steps(6) infinite}" +
      "@keyframes lp{to{background-position:-648px 100%}}@keyframes lp4{to{background-position:-306px 100%}}" +
      "@media (prefers-reduced-motion:reduce){.lawpy{animation:none!important}}"
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
    var lawpy = el("span", { "class": "lawpy", role: "img", "aria-label": "Lawpy, the Actuent mascot" })
    if (!noLawpy) link.appendChild(lawpy)
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
      lawpy.className = "lawpy" + (d.score >= 90 ? " dance" : d.score < 50 ? " think" : "")
    }).catch(function () { score.textContent = "–"; label.textContent = "Actuent" })
  }

  var hosts = document.querySelectorAll("[data-actuent-badge]")
  for (var i = 0; i < hosts.length; i++) if (!hosts[i].__actuent) { hosts[i].__actuent = 1; render(hosts[i], hosts[i].getAttribute("data-actuent-badge"), hosts[i].getAttribute("data-theme"), hosts[i].getAttribute("data-lawpy") === "off") }
  if (script && script.getAttribute("data-domain")) {
    var host = el("span", {})
    script.parentNode.insertBefore(host, script)
    render(host, script.getAttribute("data-domain"), script.getAttribute("data-theme"), script.getAttribute("data-lawpy") === "off")
  }
})()
