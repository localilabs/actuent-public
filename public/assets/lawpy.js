// Lawpy, Actuent's mascot, as a web component:
//   <script src="https://api.actuent.ai/assets/lawpy.js" defer></script>
//   <lawpy-mascot state="wave" scale="4" then="idle"></lawpy-mascot>
// States: idle (blinks now and then), wave, talk, think, dance.
// Attributes: state, scale (pixels per Lawpy pixel, default 4), loops (play the state this many
// times, then switch to `then`, default idle). From JS: el.play("dance", { loops: 2, then: "idle" }).
// People who prefer reduced motion get a still Lawpy.
// Seasonal outfits: a witch hat in October, a Santa hat 1–26 December, a party hat on launch day
// (14 October 2026). hat="none" turns it off; hat="witch" / "santa" / "party" forces one.
(function () {
  if (customElements.get("lawpy-mascot")) return
  var BASE = "https://api.actuent.ai/assets/lawpy/"
  // Sprite sheets: frame width, frame count, sheet height, frames per second.
  var STATES = {
    idle: { file: "idle.svg", w: 14, frames: 1, h: 11, fps: 1 },
    wave: { file: "wave.svg", w: 14, frames: 6, h: 11, fps: 7 },
    talk: { file: "talk.svg", w: 14, frames: 8, h: 11, fps: 9 },
    think: { file: "think.svg", w: 17, frames: 6, h: 11, fps: 4 },
    // v=2: the 12-frame dance (September 2026); the version stops browsers using the old 8-frame sheet.
    dance: { file: "dance.svg?v=2", w: 18, frames: 12, h: 12, fps: 10 }
  }
  // Top of Lawpy's head in each frame of each sheet: [row, centre column], in sheet pixels.
  var HEADS = { idle: [[0, 8]], wave: [[0, 8]], talk: [[0, 8]], think: [[0, 8]],
    dance: [[1, 10], [2, 10], [1, 12], [0, 12], [2, 10], [1, 8], [0, 8], [2, 10], [1, 11], [0, 10], [1, 9], [2, 11]] }
  // Hats as pixel rows: k = purple, o = orange, r = red, w = white.
  var HATS = {
    witch: ["....k....", "...kk....", "...kkk...", "..kkkkk..", "..ooooo..", "kkkkkkkkk"],
    santa: [".......ww", ".....rrw.", "...rrrr..", "..rrrrrr.", ".wwwwwwww"],
    party: ["...yy...", "...pp...", "..pbpp..", "..ppyp..", ".pbppbp.", ".pppppp."]
  }
  var HAT_COLOURS = { k: "#6b3fa0", o: "#ff8a3d", r: "#d7263d", w: "#f5f5f5", p: "#ff4f9a", y: "#ffd23f", b: "#3fa7ff" }
  function hatSvg(rows) {
    var rects = ""
    rows.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (HAT_COLOURS[row[x]]) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + HAT_COLOURS[row[x]] + '"/>' })
    return "url(\"data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + rows[0].length + ' ' + rows.length + '" shape-rendering="crispEdges">' + rects + '</svg>') + "\")"
  }
  function seasonHat() {
    var d = new Date(), m = d.getMonth(), day = d.getDate()
    // Launch day (14 October 2026): a party hat.
    if (d.getFullYear() === 2026 && m === 9 && day === 14) return "party"
    return m === 9 ? "witch" : m === 11 && day <= 26 ? "santa" : null
  }
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  class LawpyMascot extends HTMLElement {
    static get observedAttributes() { return ["state", "scale"] }
    ensure() {
      if (this.sprite) return
      this.sprite = document.createElement("span")
      this.sprite.style.cssText = "display:block;image-rendering:pixelated;image-rendering:crisp-edges;background-repeat:no-repeat;background-position:0 100%"
      this.appendChild(this.sprite)
      this.style.display = this.style.display || "inline-block"
      this.style.lineHeight = "0"
      if (!this.hasAttribute("role")) this.setAttribute("role", "img")
      if (!this.hasAttribute("aria-label")) this.setAttribute("aria-label", "Lawpy, the Actuent mascot")
      var hat = this.getAttribute("hat") || "auto"
      this.hatName = hat === "none" ? null : HATS[hat] ? hat : seasonHat()
      if (this.hatName) {
        this.style.position = this.style.position || "relative"
        this.hat = document.createElement("span")
        this.hat.setAttribute("aria-hidden", "true")
        this.hat.style.cssText = "position:absolute;pointer-events:none;background-repeat:no-repeat;background-size:100% 100%;image-rendering:pixelated;background-image:" + hatSvg(HATS[this.hatName])
        this.appendChild(this.hat)
      }
    }
    // The hat sits on top of Lawpy's head, following it as he moves.
    placeHat(state, frame, s, scale) {
      if (!this.hat) return
      var rows = HATS[this.hatName], heads = HEADS[state] || HEADS.idle, head = heads[frame % heads.length]
      this.hat.style.width = rows[0].length * scale + "px"
      this.hat.style.height = rows.length * scale + "px"
      this.hat.style.left = (head[1] - rows[0].length / 2) * scale + "px"
      this.hat.style.top = (12 - s.h + head[0] - rows.length + 1) * scale + "px"
    }
    connectedCallback() {
      this.ensure()
      this.play(this.getAttribute("state") || "idle", { loops: Number(this.getAttribute("loops")) || 0, then: this.getAttribute("then") || "idle" })
    }
    disconnectedCallback() { this.stop() }
    attributeChangedCallback(name, before, after) {
      if (this.sprite && before !== after) this.play(name === "state" ? after || "idle" : this.current || "idle")
    }
    stop() { clearTimeout(this.timer); this.timer = null }
    play(state, opts) {
      opts = opts || {}
      this.ensure()
      var s = STATES[state] || STATES.idle
      var scale = Math.max(1, Number(this.getAttribute("scale")) || 4)
      this.stop()
      this.current = state in STATES ? state : "idle"
      // The box fits the widest and tallest frames (the dance), so Lawpy doesn't make the page
      // jump when he changes what he's doing.
      this.style.width = 18 * scale + "px"
      this.style.height = 12 * scale + "px"
      var sp = this.sprite
      sp.style.width = s.w * scale + "px"
      sp.style.height = 12 * scale + "px"
      sp.style.backgroundImage = "url(" + BASE + s.file + ")"
      sp.style.backgroundSize = s.w * s.frames * scale + "px " + s.h * scale + "px"
      sp.style.backgroundPositionX = "0px"
      this.placeHat(this.current, 0, s, scale)
      var self = this, frame = 0, loopsLeft = opts.loops || 0
      if (this.current === "idle") { if (!still) this.blinkLater(scale); return }
      if (still) {
        if (loopsLeft) this.timer = setTimeout(function () { self.play(opts.then || "idle") }, 1500)
        return
      }
      var tick = function () {
        frame = (frame + 1) % s.frames
        sp.style.backgroundPositionX = -frame * s.w * scale + "px"
        self.placeHat(self.current, frame, s, scale)
        if (frame === 0 && loopsLeft && --loopsLeft === 0) { self.play(opts.then || "idle"); return }
        self.timer = setTimeout(tick, 1000 / s.fps)
      }
      this.timer = setTimeout(tick, 1000 / s.fps)
    }
    // Idle: a blink every few seconds.
    blinkLater(scale) {
      var self = this, sp = this.sprite
      this.timer = setTimeout(function () {
        sp.style.backgroundImage = "url(" + BASE + "blink.svg)"
        self.timer = setTimeout(function () {
          sp.style.backgroundImage = "url(" + BASE + "idle.svg)"
          self.blinkLater(scale)
        }, 140)
      }, 2500 + Math.random() * 3500)
    }
  }
  // Preload the sheets so a state change never flashes empty.
  Object.keys(STATES).concat(["blink"]).forEach(function (k) { var i = new Image(); i.src = BASE + (STATES[k] ? STATES[k].file : k + ".svg") })
  customElements.define("lawpy-mascot", LawpyMascot)
})()
