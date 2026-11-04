// Plays the game's WeatherRenderers XML files on a canvas. The XML format has no public documentation,
// so units here (screen fractions, per-second particle speeds, 1080p padding) are read from how the files use them.
const Weather = (() => {
  const picker = document.getElementById("weather_select");
  const camera = document.getElementById("weather_camera");
  const canvas = document.getElementById("weather_canvas");
  const status = document.getElementById("weather_status");
  const ctx = canvas.getContext("2d");
  const REF_HEIGHT = 1080;
  const ANCHORS = { DOWN_LEFT: [0, 1], DOWN_CENTER: [0.5, 1], UPPER_LEFT: [0, 0], LEFT_CENTER: [0, 0.5], CENTER: [0.5, 0.5] };
  const images = new Map();
  let scene = null;
  let legacy = [];
  let token = 0;
  let last = 0;
  let clock = 0;

  const nums = (text) => String(text).split(",").map((v) => parseFloat(v));
  const setOf = (el) => Object.fromEntries([...el.children].filter((c) => c.tagName === "Set").map((c) => [c.getAttribute("name"), c.textContent.trim()]));
  const curveOf = (el) => [...el.querySelectorAll(":scope > KeyFrame")].map((k) => nums(k.textContent));
  const randomIn = (min, max) => min + Math.random() * (max - min);

  // Keys are scanned in file order, as some files contain out-of-range times such as 9.999
  function evalCurve(keys, t) {
    if (!keys.length) return 1;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return t1 === t0 ? v1 : v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
      }
    }
    return keys[keys.length - 1][1];
  }

  function loadImage(file) {
    const path = `assets/weather/${file.replace(/\.rttex$/i, ".png")}`;
    if (!images.has(path)) {
      images.set(path, new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = path;
      }));
    }
    return images.get(path);
  }

  function readValue(el) {
    if (el.tagName === "Random") return { min: nums(el.getAttribute("min")), max: nums(el.getAttribute("max")) };
    if (el.tagName === "Curve") return { curve: curveOf(el) };
    return { fixed: el.textContent.trim() };
  }

  function roll(spec, fallback) {
    if (!spec) return fallback;
    if (spec.fixed !== undefined) return nums(spec.fixed);
    return spec.min.map((min, i) => randomIn(min, spec.max[i] ?? min));
  }

  async function parse(name) {
    const response = await fetch(`assets/weather/xml/${name}.xml`);
    if (!response.ok) throw new Error("This weather file could not be loaded.");
    const doc = new DOMParser().parseFromString(await response.text(), "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("This weather file could not be read.");
    const sprites = {};
    for (const el of doc.querySelectorAll("Data Sprite")) {
      const image = await loadImage(el.getAttribute("fileName"));
      if (!image) continue;
      const size = el.getAttribute("textureSize");
      const [fw, fh] = size ? nums(size) : [image.width, image.height];
      sprites[el.getAttribute("name")] = { image, fw, fh: fh ?? fw, frame: nums(el.getAttribute("frame") || "0,0") };
    }
    const animations = {};
    const animate = (sprite, entry) => { (animations[sprite] ||= []).push(entry); };
    for (const el of doc.querySelectorAll("Animations > *")) {
      const sprite = el.getAttribute("sprite");
      const time = parseFloat(el.getAttribute("animTime")) || 1000;
      if (el.tagName === "SpriteCurveAnimation") {
        for (const c of el.querySelectorAll("Curve")) animate(sprite, { type: "curve", prop: c.getAttribute("name"), keys: curveOf(c), time });
      } else if (el.tagName === "SpriteSinPulseAnimation") {
        for (const p of el.querySelectorAll("Parameter")) {
          const s = setOf(p);
          animate(sprite, { type: "sin", prop: p.getAttribute("name"), period: parseFloat(s.period) || 1000, scale: parseFloat(s.scale) || 0, offset: parseFloat(s.offset) || 0 });
        }
      } else if (el.tagName === "SpriteAnimation") {
        animate(sprite, { type: "frames", frames: [...el.querySelectorAll("Frame")].map((f) => nums(f.textContent)), time });
      }
    }
    const systems = {};
    for (const el of doc.querySelectorAll("ParticleSystem")) {
      const read = (node) => Object.fromEntries([...node.children].map((c) => [c.getAttribute("name"), readValue(c)]));
      const emitter = el.querySelector("Emitter");
      const particle = el.querySelector("Particle");
      systems[el.getAttribute("name")] = {
        emitter: read(emitter), particle: read(particle), horizontal: particle.getAttribute("moveConstraint") === "Horizontal",
        toTarget: particle.getAttribute("autoLifeTimeToTarget") === "true", live: [], wait: 0,
      };
    }
    const variables = {};
    for (const el of doc.querySelectorAll("VariableMap > Set")) variables[el.getAttribute("name")] = el.textContent.trim();
    const rules = [];
    for (const stage of doc.querySelectorAll("RenderRules > *")) rules.push(...stage.children);
    Object.values(systems).forEach((system) => { for (let i = 0; i < 600; i++) stepSystem(system, sprites, 0.5); });
    return { sprites, animations, systems, variables, rules };
  }

  function spawn(system) {
    const p = system.particle;
    const [x, y] = roll(p.offset, [0, 0]);
    const velocity = roll(p.initialVelocity, [0, 0]);
    const target = p.targetPos ? nums(p.targetPos.fixed) : null;
    let life = (roll(p.lifeTime, [10]))[0];
    if (system.toTarget && target && velocity[0]) life = Math.max(0.1, (target[0] - x) / velocity[0]);
    system.live.push({ x, y, vx: velocity[0], vy: system.horizontal ? 0 : velocity[1] ?? 0, age: 0, life, scale: roll(p.initialScale, [1])[0], angle: roll(p.initialAngle, [0])[0] });
  }

  function stepSystem(system, sprites, dt) {
    system.live = system.live.filter((p) => {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.age < p.life;
    });
    system.wait -= dt;
    if (system.wait <= 0) {
      const limit = system.emitter.maxParticleInstanceAtOnce ? parseFloat(system.emitter.maxParticleInstanceAtOnce.fixed) : Infinity;
      const count = system.emitter.particlesPerEmission ? parseFloat(system.emitter.particlesPerEmission.fixed) : 1;
      for (let i = 0; i < count && system.live.length < Math.min(limit, 400); i++) spawn(system);
      system.wait = roll(system.emitter.emissionInterval, [1])[0];
    }
  }

  function tinted(sprite, color) {
    const key = color.join(",");
    sprite.tints ||= {};
    if (!sprite.tints[key]) {
      const layer = document.createElement("canvas");
      layer.width = sprite.image.width;
      layer.height = sprite.image.height;
      const g = layer.getContext("2d");
      g.drawImage(sprite.image, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      g.fillRect(0, 0, layer.width, layer.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(sprite.image, 0, 0);
      sprite.tints[key] = layer;
    }
    return sprite.tints[key];
  }

  function animated(name) {
    const out = { alpha: 1, x: 0, rotation: 0, frame: null };
    for (const a of scene.animations[name] || []) {
      if (a.type === "frames") {
        out.frame = a.frames[Math.floor((clock % a.time) / a.time * a.frames.length)];
        continue;
      }
      const value = a.type === "curve"
        ? evalCurve(a.keys, (clock % a.time) / a.time)
        : a.offset + a.scale * Math.sin((clock / a.period) * Math.PI * 2);
      if (a.prop === "alpha") out.alpha *= value;
      if (a.prop === "pos.x") out.x = value;
      if (a.prop === "rotation") out.rotation = value;
    }
    return out;
  }

  function drawSprite(sprite, frame, x, y, sx, sy, options = {}) {
    const source = options.tint ? tinted(sprite, options.tint) : sprite.image;
    const [fx, fy] = frame || sprite.frame;
    ctx.save();
    ctx.translate(x, y);
    if (options.rotation) {
      const [px, py] = options.pivot || [sprite.fw / 2, sprite.fh / 2];
      ctx.translate(px * sx, py * sy);
      ctx.rotate((options.rotation * Math.PI) / 180);
      ctx.translate(-px * sx, -py * sy);
    }
    let w = sprite.fw * sx;
    let h = sprite.fh * sy;
    if (options.flipX) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    if (options.flipY) { ctx.translate(0, h); ctx.scale(1, -1); }
    ctx.drawImage(source, fx * sprite.fw, fy * sprite.fh, sprite.fw, sprite.fh, 0, 0, w, h);
    ctx.restore();
  }

  function colorOf(value) {
    const text = scene.variables[value] || value;
    return nums(text);
  }

  function renderSprite(el, state, W, H) {
    const name = el.getAttribute("name");
    const sprite = scene.sprites[name];
    if (!sprite) return;
    const anim = animated(name);
    const extra = nums(el.getAttribute("scale") || "1,1");
    const sx = state.scale[0] * extra[0];
    const sy = state.scale[1] * (extra[1] ?? extra[0]);
    const [ox, oy] = nums(el.getAttribute("offset") || "0,0");
    const [ax, ay] = ANCHORS[el.getAttribute("alignment")] || [0, 0];
    const w = sprite.fw * sx;
    const h = sprite.fh * sy;
    const flip = nums(el.getAttribute("flip") || state.flip || "0,0");
    let x = (ox + anim.x) * W - ax * w - Number(camera.value) * state.parallax;
    const y = oy * H - ay * h;
    const override = el.getAttribute("tintOverride");
    ctx.globalCompositeOperation = el.getAttribute("blend") === "ADDITIVE" ? "lighter" : "source-over";
    ctx.globalAlpha = Math.max(0, Math.min(1, anim.alpha * (override ? nums(override)[3] / 255 : 1)));
    const options = {
      tint: override ? nums(override).slice(0, 3) : state.tint, flipX: flip[0] > 0, flipY: flip[1] > 0,
      rotation: el.getAttribute("useFixedRotation") === "true" ? parseFloat(el.getAttribute("fixedRotation")) || 0 : anim.rotation,
      pivot: el.getAttribute("rotationPoint") ? nums(el.getAttribute("rotationPoint")) : null,
    };
    if (state.wrap && w > 1 && !options.rotation) {
      x = ((x % w) + w) % w - w;
      for (; x < W; x += w) drawSprite(sprite, anim.frame, x, y, sx, sy, options);
    } else {
      drawSprite(sprite, anim.frame, x, y, sx, sy, options);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function renderParticles(system, W, H) {
    const p = system.particle;
    const sprite = scene.sprites[p.sprite && p.sprite.fixed];
    if (!sprite) return;
    const [ax, ay] = ANCHORS[p.renderAlignment && p.renderAlignment.fixed] || [0.5, 0.5];
    const k = H / REF_HEIGHT;
    for (const item of system.live) {
      const alpha = p.initialAlpha ? evalCurve(p.initialAlpha.curve, item.age / item.life) : 1;
      const s = item.scale * k;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      drawSprite(sprite, null, item.x * W - ax * sprite.fw * s, item.y * H - ay * sprite.fh * s, s, s, { rotation: item.angle });
    }
    ctx.globalAlpha = 1;
  }

  function render(dt) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const state = { scale: [1, 1], parallax: 0, wrap: true, flip: null, tint: null };
    Object.values(scene.systems).forEach((system) => stepSystem(system, scene.sprites, dt));
    for (const el of scene.rules) {
      if (el.tagName === "ContextUpdate") {
        const s = setOf(el);
        const type = el.getAttribute("type");
        const ref = scene.sprites[s.sprite];
        if (type === "ScaleScreenHeight" && ref) {
          const v = (H + (parseFloat(s.padding) || 0) * (H / REF_HEIGHT)) / ref.fh;
          state.scale = [v, v];
        } else if (type === "ScaleScreenSize" && ref) {
          state.scale = [W / ref.fw, H / ref.fh];
        } else if (type === "PositionParallax") {
          state.parallax = parseFloat(s.scale) || 0;
          state.wrap = s.wrapHorizontal !== "false";
        } else if (type === "SetFlip") {
          state.flip = s.flip;
        } else if (type === "SetTint") {
          const color = colorOf(s.tint);
          state.tint = color[0] === 255 && color[1] === 255 && color[2] === 255 ? null : color;
        }
      } else if (el.tagName === "SpriteRender") {
        renderSprite(el, state, W, H);
      } else if (el.tagName === "ParticleSystemRender") {
        const system = scene.systems[el.getAttribute("name")];
        if (system) renderParticles(system, W, H);
      }
    }
  }

  /* Weathers the client draws in code: texture lists are real, placement is approximate */
  function legacyScene(entry) {
    return Promise.all(entry.layers.map(async (layer) => ({ ...layer, image: layer.tex ? await loadImage(`game/${layer.tex}.rttex`) : null })))
      .then((layers) => ({ legacy: true, layers: layers.filter((l) => l.image || l.color), name: entry.name }));
  }

  const isBackdrop = (l) => Boolean(l.tex) && /sky|back|bg$|sunset$|twirl/i.test(l.tex) || l.w <= 64;

  // Layer tinted like the in-game photo it was measured from; kept, as tinting every frame is slow
  const fitTints = new Map();
  function tintedImage(l) {
    if (!l.fit.tint || l.fit.tint.every((v) => v > 0.98)) return l.image;
    if (!fitTints.has(l.tex)) {
      const layer = document.createElement("canvas");
      layer.width = l.image.width;
      layer.height = l.image.height;
      const g = layer.getContext("2d");
      g.drawImage(l.image, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = `rgb(${l.fit.tint.map((v) => Math.round(v * 255)).join(",")})`;
      g.fillRect(0, 0, layer.width, layer.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(l.image, 0, 0);
      fitTints.set(l.tex, layer);
    }
    return fitTints.get(l.tex);
  }

  // Sizes and heights measured from 1920x1080 in-game photos, in tools/weather-fits.json
  function drawFitted(l, index, W, cam, stackedCount) {
    const u = W / 1920;
    const fit = l.fit;
    if (l.kind === "sun" || l.kind === "moon") {
      ctx.drawImage(l.image, fit.x * u - cam * 0.01, fit.y * u, l.w * fit.s * u, l.h * fit.s * u);
      return;
    }
    const image = tintedImage(l);
    // A measured x means one placed piece, unless it's wide enough to fill the screen
    if (fit.x !== undefined && l.image.width * fit.s < 1900) {
      ctx.drawImage(image, fit.x * u - cam * 0.05, fit.y * u, l.image.width * fit.s * u, l.image.height * fit.s * u);
      return;
    }
    const w = l.image.width * fit.s * u;
    const parallax = stackedCount > 1 ? 0.05 + (index / (stackedCount - 1)) * 0.4 : 0.1;
    let x = -((cam * parallax) % w);
    if (x > 0) x -= w;
    for (; x < W; x += w) ctx.drawImage(image, x, fit.y * u, w, l.image.height * fit.s * u);
  }

  /* Night, Comet, Mars and Wolf: one class in the client (Background_Night), read from its draw code */
  const NIGHT_FAMILY = {
    Night: { moon: "fixed", hills: "#000000", back: null, pastel: true, stars: 200 },
    // Client colours are stored blue, green, red, alpha. Weather 16 and 17; 17 is the one in the photo
    Comet: { moon: "moving", hills: "#00280a", back: "#00ff20", fill: "#00010c", moonTint: "#0aff64", stars: 200, comet: true },
    "Comet 2": { moon: "moving", hills: "#002020", back: "#00ffff", fill: "#00016a", moonTint: "#32ffff", stars: 200, comet: true },
    // Weather 47 and 48. The comet list is only built for 47
    Meteor: { moon: "fixed", hills: "#000000", back: null, pastel: true, stars: 200, comet: true },
    Stars: { moon: "fixed", hills: "#000000", back: null, pastel: true, stars: 200 },
  };
  const STAR_PASTELS = ["200,255,255", "255,255,255", "200,200,255", "255,255,200", "200,255,200"];
  const between = (min, max) => min + Math.random() * (max - min);

  function nightStars(style) {
    return Array.from({ length: style.stars }, () => {
      const size = between(0.2, 2);
      const alpha = Math.min(size, 1);
      const color = style.pastel ? STAR_PASTELS[Math.floor(Math.random() * 5)] : `${between(0, 128) | 0},${between(128, 255) | 0},${between(200, 255) | 0}`;
      return { type: Math.floor(Math.random() * 7), x: Math.random(), y: Math.random(), size, spin: between(-30, 30), angle: between(0, 360), color, alpha: style.pastel ? alpha : alpha / 2 };
    });
  }

  function colorLayer(image, color) {
    const layer = document.createElement("canvas");
    layer.width = image.width;
    layer.height = image.height;
    const g = layer.getContext("2d");
    g.drawImage(image, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = color;
    g.fillRect(0, 0, layer.width, layer.height);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(image, 0, 0);
    return layer;
  }

  // Stars are 16px cells: types 1-3 on the first row and 4-7 on the second; type 0 isn't drawn
  function drawStar(star, sheet, W, H, seconds) {
    if (!star.type || !sheet) return;
    const column = star.type >= 4 ? star.type - 4 : star.type;
    const row = star.type >= 4 ? 1 : 0;
    const size = 16 * star.size * (W / 1024);
    if (!star.sprite) {
      const cell = document.createElement("canvas");
      cell.width = cell.height = 16;
      const g = cell.getContext("2d");
      g.drawImage(sheet, column * 16, row * 16, 16, 16, 0, 0, 16, 16);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = `rgb(${star.color})`;
      g.fillRect(0, 0, 16, 16);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(sheet, column * 16, row * 16, 16, 16, 0, 0, 16, 16);
      star.sprite = cell;
    }
    ctx.save();
    ctx.globalAlpha = star.alpha;
    ctx.translate(star.x * (W + 16) - 8, star.y * (H + 16) - 8);
    ctx.rotate(((star.angle + star.spin * seconds) * Math.PI) / 180);
    ctx.drawImage(star.sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function renderNightFamily(W, H, style) {
    const cam = Number(camera.value);
    const seconds = clock / 1000;
    const find = (test) => scene.layers.find(test);
    const sky = find((l) => l.kind === "layer" && l.w <= 64);
    ctx.fillStyle = style.fill || "#000";
    ctx.fillRect(0, 0, W, H);
    if (sky) {
      const scaleY = H / 38;
      const image = style.back ? (style.backLayer ||= colorLayer(sky.image, style.back)) : sky.image;
      ctx.drawImage(image, 0, -1.5 * scaleY, W, sky.image.height * scaleY);
    }
    scene.stars ||= nightStars(style);
    const sheet = find((l) => l.kind === "stars")?.image;
    for (const star of scene.stars) drawStar(star, sheet, W, H, seconds);
    const moon = find((l) => l.kind === "moon");
    if (moon) {
      if (style.moon === "fixed") {
        const scale = W / 161 / 6;
        ctx.drawImage(moon.image, W * 0.1, H * 0.1, moon.image.width * scale, moon.image.height * scale);
      } else {
        const angle = ((25 + seconds * 0.5) * 1.8 + 180) * (Math.PI / 180);
        const scale = W / 161 / 20;
        const size = moon.image.width * scale;
        const image = (scene.moonLayer ||= colorLayer(moon.image, style.moonTint));
        ctx.drawImage(image, (1 + Math.cos(angle)) * (W / 2) - size / 2, H / 3 + (H / 4) * Math.sin(angle) - size / 2, size, size);
      }
    }
    const hills = scene.layers.filter((l) => l.kind === "layer" && l.w > 64 && /hills/.test(l.tex));
    hills.forEach((l, i) => {
      const u = W / 512;
      const w = l.image.width * u;
      const h = l.image.height * u;
      const bottom = H + 2 + [-46, 60, 0][i] * u;
      let x = Math.floor(-0.2 * (i + 1) * cam * (W / 1024));
      while (x + w < 0) x += w;
      l.dark ||= colorLayer(l.image, style.hills);
      for (; x <= W; x += w) ctx.drawImage(l.dark, x, bottom - h, w, h);
    });
    if (style.comet) {
      const comet = layerOf("w_cmt");
      if (comet) {
        const t = (seconds * 0.04) % 1;
        const headX = W * (1.05 - t * 1.3);
        const headY = H * (0.05 + t * 0.35);
        for (let i = 0; i < 14; i++) {
          const size = (70 - i * 4) * (W / 1024);
          ctx.globalAlpha = 1 - i / 15;
          ctx.drawImage(comet, headX + i * 14 * (W / 1024) - size / 2, headY - i * 4 * (W / 1024) - size / 2, size, size);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /* Weathers the client builds from a layer list. Values are from each class's constructor: back to front.
     k: scale on top of width/1024, y: fraction of screen height for the layer's bottom, x: fraction of width,
     speed: client scroll value, drift: pixels per second. center draws around that point instead, without tiling;
     spin: degrees per second; cell: [column, row, columns, rows] when the texture holds several frames. */
  const LAYER_SCENES = {
    "Holiday Haven": [
      { tex: "bg_hhvn_layer4", k: 0.75, y: 0.67 }, { tex: "bg_hhvn_layer3", k: 0.75, x: -0.15, y: 0.64 },
      { tex: "bg_hhvn_car_b", k: 0.75, y: 0.33, speed: 3, drift: -5 }, { tex: "bg_hhvn_layer2", k: 0.75, y: 0.83, speed: 6 },
      { tex: "bg_hhvn_car_a", k: 0.75, y: 0.41, speed: 9, drift: 10 }, { tex: "bg_hhvn_layer1", k: 0.75, y: 1, speed: 25 },
    ],
    Steampunk: [
      { tex: "bg_vd_stpk_layer6", y: 0.28, speed: 8 }, { tex: "bg_vd_stpk_layer5", y: 1.15, speed: 12, fitHeight: true },
      { tex: "bg_vd_stpk_layer4a", center: true, y: 0.5, x: 0.5 }, { tex: "bg_vd_stpk_layer4b", center: true, y: 0.5, x: 0.5 },
      { tex: "bg_vd_stpk_layer3", k: 0.75, upper: true, x: 0.5, y: 0.1 },
      { tex: "bg_vd_stpk_layer2a", edge: "left", y: 1, speed: 15 }, { tex: "bg_vd_stpk_layer2b", edge: "right", y: 1, speed: 15 },
      { tex: "bg_vd_stpk_layer1", y: 1, speed: 60, aspect: true },
    ],
    "Black Hole": [
      { tex: "bg_bh_sta", center: true },
      { tex: "bg_bh_pivot", center: true, cell: [0, 0, 2, 1] }, { tex: "bg_bh_pivot", center: true, cell: [1, 0, 2, 1] },
      { tex: "bg_bh_ring1", center: true, spin: -6 }, { tex: "bg_bh_ring2-4", center: true, spin: 4 }, { tex: "bg_bh_ring3", center: true, spin: -2.4 },
      { tex: "bg_bh_hal", center: true, cell: [0, 0, 1, 2] }, { tex: "bg_bh_hal", center: true, cell: [0, 1, 1, 2] },
    ],
    Ascended: [
      { tex: "st_asec_backsky", y: 0.8, speed: 2.5 }, { tex: "st_asec_back", y: 1, speed: 3.75 },
      { tex: "st_asec_mid2", y: 0.75, speed: 12.5, k: 0.75 }, { tex: "st_asec_mid1", y: 1.02, speed: 12.5 }, { tex: "st_asec_front", y: 1, speed: 25 },
    ],
    Destroyed: [
      { tex: "st_dsec_backsky", y: 0.8, speed: 2.5 }, { tex: "st_dsec_back", y: 1.1, speed: 3.75 },
      { tex: "st_dsec_mid2", y: 0.75, speed: 12.5, k: 0.75 }, { tex: "st_dsec_mid1", y: 1.02, speed: 12.5 }, { tex: "st_dsec_front", y: 1, speed: 25 },
    ],
    "Legendary City": [
      { tex: "ld_ctyrer", k: 0.75, y: 1 }, { tex: "ld_ctymid2", y: 0.8, speed: 10 }, { tex: "ld_ctymid", k: 0.75, y: 1, speed: 15 },
      { tex: "ld_ctydogn", k: 0.75, y: 0.91, speed: 20 }, { tex: "ld_ctyfro", k: 0.75, y: 1, speed: 30 },
    ],
    "Realm Of Spirits": [
      { tex: "bg_rlm_layer8", y: 1 }, { tex: "bg_rlm_layer7", y: 1, speed: 4 }, { tex: "bg_rlm_layer6", y: 1, speed: 5 }, { tex: "bg_rlm_layer5", y: 1, speed: 10 },
      { tex: "bg_rlm_layer3", center: true, x: 0.5, y: 0.5 }, { tex: "bg_rlm_layer2", center: true, x: 0.5, y: 0.75 }, { tex: "bg_rlm_layer1", y: 1, speed: 30 },
    ],
  };

  function drawClientLayer(spec, image, W, H, cam, seconds) {
    const scale = spec.fitHeight ? H / image.height : (W / 1024) * (spec.k || 1);
    const w = image.width * scale;
    const h = image.height * scale;
    if (spec.upper) {
      ctx.drawImage(image, W * spec.x - w / 2, H * spec.y, w, h);
      return;
    }
    if (spec.center) {
      ctx.save();
      ctx.translate(W * (spec.x ?? 0.5), H * (spec.y ?? 0.5));
      if (spec.spin) ctx.rotate(((spec.spin * seconds) * Math.PI) / 180);
      if (spec.cell) {
        const [column, row, columns, rows] = spec.cell;
        const sw = image.width / columns;
        const sh = image.height / rows;
        ctx.drawImage(image, column * sw, row * sh, sw, sh, (-sw * scale) / 2, (-sh * scale) / 2, sw * scale, sh * scale);
      } else {
        ctx.drawImage(image, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
      return;
    }
    const top = H * spec.y - h + (spec.aspect ? (W / H - 1.3333) * image.height * (W / 1920) : 0);
    if (spec.edge) {
      const shift = (cam * (spec.speed || 0)) / 100;
      ctx.drawImage(image, spec.edge === "left" ? -shift : W - w - shift, top, w, h);
      return;
    }
    const start = W * (spec.x || 0) - (cam * (spec.speed || 0)) / 100 + (spec.drift || 0) * seconds * (W / 1024);
    let x = ((start % w) + w) % w - w;
    for (; x < W; x += w) ctx.drawImage(image, x, top, w, h);
  }

  function renderLayerScene(W, H, specs) {
    const cam = Number(camera.value);
    const seconds = clock / 1000;
    const sky = scene.layers.find((l) => l.image && l.w <= 64);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (sky) ctx.drawImage(sky.image, 0, 0, W, H);
    for (const spec of specs) {
      const layer = scene.layers.find((l) => l.tex === spec.tex);
      if (layer?.image) drawClientLayer(spec, layer.image, W, H, cam, seconds);
    }
  }

  /* Weathers with their own class. Each follows that class's draw calls: stretched sky first, then
     u = W/512 hills at the shared offsets, -0.2*(i+1)*camera scroll. Names in comments are client classes. */
  const layerOf = (tex) => scene.layers.find((l) => l.tex === tex)?.image;
  const HILL_LIFT = [-46, 60, 0];

  function sky(tex, W, H, y = 0) {
    const image = layerOf(tex);
    if (image) ctx.drawImage(image, 0, y, W, H - y * 2);
  }

  function tiled(image, x, top, scale, W) {
    if (!image) return;
    const w = image.width * scale;
    let at = ((x % w) + w) % w - w;
    for (; at < W; at += w) ctx.drawImage(image, at, top, w, image.height * scale);
  }

  function tintOnce(tex, color) {
    const image = layerOf(tex);
    if (!image) return null;
    const key = `${tex}|${color}`;
    if (!fitTints.has(key)) fitTints.set(key, colorLayer(image, color));
    return fitTints.get(key);
  }

  function hillRow(textures, W, H, color) {
    const cam = Number(camera.value);
    const u = W / 512;
    textures.forEach((tex, i) => {
      const image = color ? tintOnce(tex, color) : layerOf(tex);
      if (image) tiled(image, -0.2 * (i + 1) * cam * (W / 1024), H + 2 + HILL_LIFT[i] * u - image.height * u, u, W);
    });
  }

  function drifting(tex, W, y, speed, scale, seconds) {
    const image = layerOf(tex);
    if (image) tiled(image, -seconds * speed * (W / 1024), y, scale, W);
  }

  function fallingPieces(key, count, make, draw) {
    scene[key] ||= Array.from({ length: count }, make);
    scene[key].forEach(draw);
  }

  function starField(style, W, H, seconds) {
    scene.stars ||= nightStars(style);
    const sheet = layerOf("stars");
    for (const star of scene.stars) drawStar(star, sheet, W, H, seconds);
  }

  function growch(W, H, happy) {
    const f = W / 900;
    const put = (image, sx, sw, sh, cx, cy, w, h) => image && ctx.drawImage(image, sx, 0, sw, sh, (cx - w / 2) * f, (cy - h / 2) * f, w * f, h * f);
    const body = layerOf("groch_b");
    const head = layerOf("groch_h");
    const legs = layerOf("groch_l");
    const arms = layerOf("groch_a");
    put(legs, 0, 64, 64, 292, 330, 130, 130);
    put(legs, 64, 64, 64, 572, 330, 130, 130);
    if (body) put(body, 0, body.width, body.height, 425, 130, 400, 382);
    if (head) put(head, happy ? 256 : 0, 256, head.height, 430, -150, 460, 460);
    if (arms) {
      // Four cells: fists down for angry, raised arms for happy
      const offset = happy ? 256 : 0;
      put(arms, offset, 128, arms.height, 238, 132, 360, 490);
      put(arms, offset + 128, 128, arms.height, 610, 132, 360, 490);
    }
  }

  // Clouds in the client are scattered pieces of different sizes that drift slowly, not an even row
  function scatterClouds(W, H, seconds, tex = "cloud", tint = null, count = 7) {
    const image = tint ? tintOnce(tex, tint) : layerOf(tex);
    if (!image) return;
    const k = W / 1024;
    fallingPieces(`clouds_${tex}`, count, () => ({ x: Math.random(), y: Math.random() * 0.5, s: between(0.5, 1.3) }), (c) => {
      const w = image.width * c.s * k;
      const span = W + w;
      const x = ((c.x * span - seconds * 9 * c.s * k) % span + span) % span - w;
      ctx.drawImage(image, x, c.y * H, w, image.height * c.s * k);
    });
  }

  function sunnySky(W, H, color = "#6eddf4") {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  }

  function defaultSun(W, H) {
    const sun = layerOf("sun");
    if (sun) ctx.drawImage(sun, W * 0.7, H * 0.1, W / 6, ((W / 6) * sun.height) / sun.width);
  }

  // Rising or falling sprites spread over the screen
  function floaters(key, W, H, seconds, count, names, sizes, speeds, up, draw) {
    fallingPieces(key, count, () => ({ x: Math.random(), y: Math.random(), s: between(...speeds), tex: names[Math.floor(Math.random() * names.length)], size: between(...sizes), p: Math.random() * 6.3 }), (d) => {
      const t = (d.y + seconds * d.s) % 1.2;
      const y = (up ? 1.1 - t : t - 0.1) * H;
      draw(d, d.x * W + Math.sin(seconds * 0.8 + d.p) * 10 * (W / 1024), y, d.size * (W / 1024));
    });
  }

  /* Haze::Init, Update and Render, copied. 20 pieces: each channel 0.5c to c, alpha 0 to 1 (halved in the front half),
     scale 0.5 to 1 of W, speed +-50 and +-10, life 2 to 10 seconds, fading at 0.25 a second, tiled sideways. */
  function hazePiece(color, W, H, fresh, clampToRed) {
    const tone = color.map((c) => between(0.5 * c, c) | 0);
    // Flag +0x10c keeps green and blue at or below red; it's what turns Apocalypse's green into grey smoke
    if (clampToRed) { tone[1] = Math.min(tone[1], tone[0]); tone[2] = Math.min(tone[2], tone[0]); }
    const front = Math.random() < 0.5;
    const peak = front ? 0.5 : 1;
    return { tone, front, peak, x: Math.random() * W, y: between(-0.25 * H, H), vx: between(-50, 50), vy: between(-10, 10), life: between(2, 10), scale: between(0.5, 1), flip: Math.random() < 0.5, alpha: fresh ? 0 : Math.random() * peak };
  }

  function drawHaze(piece, image, W) {
    piece.layer ||= colorLayer(image, `rgb(${piece.tone.join(",")})`);
    const w = W * piece.scale;
    const h = (image.height / image.width) * w;
    ctx.globalAlpha = Math.max(0, Math.min(1, piece.alpha));
    let x = ((piece.x % w) + w) % w - w;
    for (; x < W; x += w) {
      if (piece.flip) {
        ctx.save();
        ctx.translate(x + w, piece.y);
        ctx.scale(-1, 1);
        ctx.drawImage(piece.layer, 0, 0, w, h);
        ctx.restore();
      } else ctx.drawImage(piece.layer, x, piece.y, w, h);
    }
    ctx.globalAlpha = 1;
  }

  // color is what SetColor gets in the weather factory
  function hazeWeather(W, H, dt, color, withCity, clampToRed = false) {
    const image = layerOf("haze");
    sunnySky(W, H, `rgb(${color.map((c) => c >> 1).join(",")})`);
    if (withCity) sky("sunset", W, H);
    if (!image) return;
    scene.hazes ||= Array.from({ length: 20 }, () => hazePiece(color, W, H, false, clampToRed));
    const step = (dt || 0) / 1000;
    scene.hazes.forEach((piece, i) => {
      piece.x += piece.vx * step * (W / 1024);
      piece.y += piece.vy * step * (W / 1024);
      piece.life -= step;
      if (piece.life > 0) piece.alpha = Math.min(piece.peak, piece.alpha + 0.25 * step);
      else {
        piece.alpha -= 0.25 * step;
        if (piece.alpha <= 0) scene.hazes[i] = hazePiece(color, W, H, true, clampToRed);
      }
    });
    // The captures go brighter than the colour allows, so the heatwaves are drawn additively; the client's blend flag wasn't read
    ctx.globalCompositeOperation = withCity ? "source-over" : "lighter";
    scene.hazes.filter((p) => !p.front).forEach((p) => drawHaze(p, image, W));
    if (withCity) {
      const u = W / 512;
      const line = layerOf("city2_skyline");
      if (line) tiled(line, -0.2 * Number(camera.value) * (W / 1024), H + 2 - line.height * u, u, W);
    }
    scene.hazes.filter((p) => p.front).forEach((p) => drawHaze(p, image, W));
    ctx.globalCompositeOperation = "source-over";
  }

  const partyColor = () => (Math.random() < 0.2 ? [[255, 90, 90], [224, 70, 160], [90, 210, 130], [90, 100, 220], [235, 225, 90]][Math.floor(Math.random() * 5)] : [between(100, 215) | 0, between(150, 225) | 0, between(100, 200) | 0]);

  /* Background_DigitalRain, read from the Android client's symbols: strings of 15-25 digits falling at 20-60 units
     a second, some twice as fast, each swapping a digit about 4% of frames. The far layer's colours are 0x51bc5bff
     and 0x0a5f06ff, stored blue, green, red, alpha. Column count, the near layer's look and its message are from the
     in-game photo. */
  function digitalRain(tex, W, H, dt) {
    const k = W / 1024;
    const back = layerOf(tex);
    if (back) ctx.drawImage(back, 0, -10 * k, W, H + 20 * k);
    const digit = () => String.fromCharCode(48 + Math.floor(Math.random() * 10));
    const reset = (d, fresh) => {
      d.x = Math.random();
      d.y = fresh ? Math.random() * 1.4 : -Math.random() * 0.2;
      d.near = Math.random() < 0.6;
      d.chars = d.near && Math.random() < 0.08 ? [..."NAIPOTWORG OLLEH"] : Array.from({ length: 15 + Math.floor(Math.random() * 11) }, digit);
      d.speed = between(20, 60) * (Math.random() < 0.5 ? 2 : 1);
    };
    scene.rain ||= Array.from({ length: 48 }, () => {
      const d = {};
      reset(d, true);
      return d;
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const d of scene.rain) {
      d.y += ((d.speed * k) / H) * (dt / 1000);
      if (Math.random() < 0.04) d.chars[Math.floor(Math.random() * d.chars.length)] = digit();
      const size = (d.near ? 17 : 9) * k;
      const line = size * 1.35;
      if (d.y * H - line * d.chars.length > H) reset(d, false);
      ctx.font = `bold ${size}px "Courier New", monospace`;
      d.chars.forEach((ch, i) => {
        ctx.fillStyle = d.near ? (i ? "rgb(70,205,80)" : "#fff") : i ? "rgb(6,95,10)" : "rgb(91,188,81)";
        ctx.fillText(ch, d.x * W, d.y * H - line * i);
      });
    }
  }

  // Older form: k scales from W/512, bottom-aligned. St Patricks and Ice Age's first layer match their photos this way
  function scaledGround(tex, k, speed, W, H) {
    const image = layerOf(tex);
    if (!image) return;
    const scale = (W / 512) * k;
    tiled(image, (-Number(camera.value) * speed * (W / 1024)) / 100, H + 2 - image.height * scale, scale, W);
  }

  // AddLayer without its w7 flag: scale W / texture width, tiled, bottom edge at y * H, parallax speed * K in hundredths
  function ground(tex, y, speed, W, H) {
    const image = layerOf(tex);
    if (!image) return;
    const scale = W / image.width;
    tiled(image, (-Number(camera.value) * speed * (W / 1024)) / 100, H * y - image.height * scale, scale, W);
  }

  /* Background_Clouds and Cloud::Init, copied from the client. Each cloud has a depth z from 0.1 to 1 that sets its
     scale and alpha, half are mirrored, and they start over a screen rect 1.25 times taller, in its top half. Update
     moves them by speed times the frame delta; the delta's unit isn't read, 60 per second is assumed.
     Render draws only the depths in a range, sorted back to front, so they can sit between hills. */
  function cloudsOf(key, tex, count, W, H, dt) {
    // SetScale only runs behind a flag, so clouds keep their pixel size; this canvas stands in for the 1496 wide capture
    const k = W / 1496;
    const list = (scene[key] ||= Array.from({ length: count }, () => {
      const z = between(0.1, 1);
      return { z, flip: Math.random() < 0.5, x: between(0, W / z), y: between(0, (H * 1.25 * 0.5) / z), speed: between(-1, -0.05) };
    }).sort((p, q) => p.z - q.z));
    if (scene[`${key}_t`] !== clock) {
      scene[`${key}_t`] = clock;
      for (const c of list) {
        c.x += c.speed * ((dt || 0) * 0.06);
        if (c.x < (-197 * k * c.z) / c.z) c.x = (W * 1.2) / c.z;
      }
    }
    return (from, to) => {
      const image = layerOf(tex);
      if (!image) return;
      const cam = Number(camera.value);
      for (const c of list) {
        if (c.z < from || c.z >= to) continue;
        const w = image.width * c.z * k;
        const h = image.height * c.z * k;
        const x = c.z * c.x - cam * c.z * k;
        ctx.save();
        ctx.globalAlpha = c.z;
        if (c.flip) {
          ctx.translate(x + w, c.z * c.y);
          ctx.scale(-1, 1);
          ctx.drawImage(image, 0, 0, w, h);
        } else ctx.drawImage(image, x, c.z * c.y, w, h);
        ctx.restore();
      }
    };
  }

  /* The Default, Bountiful and Monochrome Render functions are the same: sky, sun at 0.7W, 0.1H scaled W/161/6, then
     clouds 0-0.2, hill 1, clouds 0.2-0.4, hill 2, clouds 0.4-0.6, hill 3, clouds 0.6-1. Hills scroll by 0.2, 0.4 and
     0.6 of the camera and sit at H+2 plus -46, 60 and 0 times W/512. */
  function hillsWeather(W, H, dt, { skyColor, sunTex = "sun", hills, cloud = "cloud", tint = null }) {
    sunnySky(W, H, skyColor);
    const sun = layerOf(sunTex);
    if (sun) {
      const scale = W / 161 / 6;
      ctx.drawImage(sun, W * 0.7, H * 0.1, sun.width * scale, sun.height * scale);
    }
    const clouds = cloudsOf("clouds", cloud, 20, W, H, dt);
    const u = W / 512;
    const cam = Number(camera.value) * (W / 1024);
    [[0, 0.2], [0.2, 0.4], [0.4, 0.6]].forEach(([from, to], i) => {
      clouds(from, to);
      const image = tint ? tintOnce(hills[i], tint) : layerOf(hills[i]);
      if (!image) return;
      const w = 512 * u;
      let x = Math.floor(-cam * 0.2 * (i + 1));
      while (x + w < 0) x += w;
      for (; x <= W; x += w) ctx.drawImage(image, x, H + 2 + HILL_LIFT[i] * u - image.height * u, w, image.height * u);
    });
    clouds(0.6, 1);
  }

  // AddLayer's aspect flag adds (W/H - 1.3333) * texture height in screen pixels; this canvas stands in for a 1920 wide screen
  const aspectLift = (W, H, height) => (W / H - 1.3333) * height * (W / 1920);

  /* Background_Ascended::Init, from the Android client; Destroyed is assumed to share it. mid2 and mid1 are spaced apart
     by 750K, with mid2 offset by 666 of its own units. H/768 stands for a ratio whose two terms weren't both identified. */
  function sectorScene(prefix, skyTex, W, H) {
    const K = W / 1024;
    const cam = Number(camera.value);
    sunnySky(W, H, "#2482f2");
    sky(skyTex, W, H);
    const far = layerOf(`${prefix}_backsky`);
    if (far) tiled(far, (-cam * 2.5 * K) / 100, H * 0.8 - far.height * K, K, W);
    const back = layerOf(`${prefix}_back`);
    if (back) {
      const scale = W / back.width;
      tiled(back, (-cam * 3.75 * K) / 100, H - back.height * scale, scale, W);
    }
    const scale = 0.75 * ((K + H / 768) / 2);
    const spaced = (tex, offset) => {
      const image = layerOf(tex);
      if (!image) return;
      const w = image.width * scale;
      const period = w + 750 * K;
      let x = ((offset * scale - (cam * 12.5 * scale) / 100) % period + period) % period - period;
      for (; x < W; x += period) ctx.drawImage(image, x, H * 1.02 - image.height * scale, w, image.height * scale);
    };
    spaced(`${prefix}_mid2`, 666);
    spaced(`${prefix}_mid1`, 0);
    const front = layerOf(`${prefix}_front`);
    if (front) {
      const fit = W / front.width;
      tiled(front, 0, H + 4 - front.height * fit, fit, W);
    }
  }

  const CUSTOM_SCENES = {
    /* Background_Gems, from the Android client: particles11 row 3, columns 26-29 in 32px cells (yellow, red, blue, green), 100 of them, size 0.2 to 3 growing with the
       particle's number, random angle, spin of -720 to 720 degrees a second and sideways speed of -10 to 10.
       Set at runtime and not read: the fill colour and the fall speed field. These two are placeholders. */
    Gems(W, H, seconds, dt) {
      sunnySky(W, H, "#60d7f2");
      const sheet = layerOf("particles11");
      if (!sheet) return;
      const count = 100;
      const fall = 100;
      const list = (scene.gems ||= Array.from({ length: count }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, vx: between(-10, 10), vy: between(fall * 0.6 - 5, fall + 5), size: 0.2 + (i / count) * 2.8, angle: Math.random() * 360, spin: between(-720, 720), frame: 26 + Math.floor(Math.random() * 4) })));
      const step = (dt || 0) / 1000;
      for (const g of list) {
        g.x = (g.x + g.vx * step + W) % W;
        g.y = (g.y + g.vy * step) % H;
        g.angle += g.spin * step;
        const size = 32 * g.size * (W / 1024);
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate((g.angle * Math.PI) / 180);
        ctx.drawImage(sheet, g.frame * 32, 3 * 32, 32, 32, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    },
    Ascended: (W, H) => sectorScene("st_asec", "st_asec_bg", W, H),
    Destroyed: (W, H) => sectorScene("st_dsec", "mtn_skybg", W, H),
    // Background_Plaza::Init, from the Android client
    Plaza(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_cin_sky", W, H);
      const far = layerOf("bg_cin_sunhouses3");
      if (far) tiled(far, 0, H * 0.75 - (far.height * W) / far.width, W / far.width, W);
      const middle = layerOf("bg_cin_houses2");
      if (middle) {
        const scale = W / middle.width;
        tiled(middle, (-cam * 5 * K) / 100, H + aspectLift(W, H, middle.height) - middle.height * scale, scale, W);
      }
      const front = layerOf("bg_cin_houses1");
      if (front) {
        // y = 0.5 * H * (1 - H / 1080) in screen pixels; this canvas stands in for a 1920 wide screen
        const screenH = (H * 1920) / W;
        tiled(front, (-cam * 10 * K) / 100, 0.5 * screenH * (1 - screenH / 1080) * (W / 1920), W / front.width, W);
      }
    },
    // Background_NianMountains: order 350, 300, 250; parallax is the layer number. The middle one never scales below 0.8
    "Lunar New Year Nian"(W, H, seconds) {
      const cam = Number(camera.value);
      sky("bg_lnynn_sky", W, H);
      [["bg_lnynn_layer3", 1, 0.9], ["bg_lnynn_layer2", 2, 1], ["bg_lnynn_layer1", 3, 1]].forEach(([tex, index, lift]) => {
        const image = layerOf(tex);
        if (!image) return;
        const fit = W / image.width;
        const scale = index === 2 ? Math.max(fit, 0.8) : fit;
        tiled(image, (-cam * index) / 100, H * lift - image.height * scale, scale, W);
      });
      // Its own cloud helper wasn't read, so these two only drift across the top
      drifting("bg_lnynn_cloud1", W, H * 0.08, 6, W / 1024, seconds);
      drifting("bg_lnynn_cloud2", W, H * 0.2, 10, W / 1024, seconds);
    },
    // The next four are from each class's Init in the Android client
    Nebula(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_nb_sky", W, H);
      sky("bg_nb_layer3", W, H);
      const middle = layerOf("bg_nb_layer2");
      if (middle) {
        const scale = W / middle.width;
        tiled(middle, W * 0.5 - (cam * K) / 100, H - 72 - middle.height * scale, scale, W);
      }
      const front = layerOf("bg_nb_layer1");
      if (front) {
        const scale = W / front.width;
        tiled(front, (-cam * 0.2 * K) / 100, H - front.height * scale, scale, W);
      }
    },
    "Dark Mountains"(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_dm_sky", W, H);
      const far = layerOf("bg_dm_layer4");
      if (far) tiled(far, 0, 0, W / far.width, W);
      [["bg_dm_layer3", 2], ["bg_dm_layer2", 5], ["bg_dm_layer1", 10]].forEach(([tex, speed]) => {
        const image = layerOf(tex);
        if (!image) return;
        const scale = W / image.width;
        tiled(image, (-cam * speed * scale) / 100, H - image.height * scale, scale, W);
      });
    },
    "Blood Dragon"(W, H) {
      const K = W / 1024;
      const M = H / 768;
      const cam = Number(camera.value);
      sunnySky(W, H, "#2482f2");
      sky("bg_bdfc_gradient_sky", W, H);
      const sun = layerOf("bg_bdfc_sun");
      if (sun) {
        const scale = (H * 0.8) / sun.height;
        ctx.drawImage(sun, W * 0.4 - (sun.width * scale) / 2, 0, sun.width * scale, sun.height * scale);
      }
      const far = layerOf("bg_bdfc_mountain3");
      if (far) {
        const w = far.width * K * 1.15;
        const h = far.height * M * 1.15;
        for (let x = (-W * 0.15 - (cam * 0.8 * K) / 100) % w - w; x < W; x += w) ctx.drawImage(far, x, H * 0.65 - h, w, h);
      }
      const grid = layerOf("bg_bdfc_grid");
      if (grid) {
        const w = grid.width * K;
        const h = grid.height * M;
        for (let x = (W * 0.5 - w / 2 - (cam * 3 * K) / 100) % w - w; x < W; x += w) ctx.drawImage(grid, x, H * 1.3 - h, w, h);
      }
      const near = layerOf("bg_bdfc_mountain1");
      if (near) {
        const scale = W / near.width;
        tiled(near, W * 0.5 - (cam * 6 * K) / 100, H - near.height * scale, scale, W);
      }
    },
    "Prince Of Persia"(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_pp_sky", W, H);
      // Order 9000, then order 90, then the city at 200 in a separate list drawn in front
      const mountains = layerOf("bg_pp_mountains2");
      if (mountains) {
        const scale = W / mountains.width;
        tiled(mountains, (-cam * 10 * K) / 100, H + aspectLift(W, H, mountains.height) - mountains.height * scale, scale, W);
      }
      const clouds = layerOf("bg_pp_cloudsmoonstars");
      if (clouds) {
        const scale = W / clouds.width;
        tiled(clouds, 0, H * 0.75 - clouds.height * scale, scale, W);
      }
      const city = layerOf("bg_pp_cityfront1");
      if (city) ctx.drawImage(city, W * 0.5 - (city.width * K) / 2 - (cam * 5 * K) / 100, H - city.height * K, city.width * K, city.height * K);
    },
    // Background_AssassinsCreed::Init, from the Android client
    "Assassins Creed"(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_a1c5_sky", W, H);
      const far = layerOf("bg_a1c5_layer4");
      if (far) tiled(far, 0, 0, W / far.width, W);
      const hills = layerOf("bg_a1c5_layer3");
      if (hills) tiled(hills, (-cam * 5 * K) / 100, H * 0.6 - hills.height * K * 0.5, K * 0.5, W);
      // Order 100 tiles from the left of centre, order 90 sits at the centre on top; both upper-centre at 0.05H, parallax 15
      const shift = (cam * 15 * K) / 100;
      const city = layerOf("bg_a1c5_layer2_2");
      const middle = layerOf("bg_a1c5_layer2_1");
      if (city && middle) {
        const gap = (city.width * K) / 2 + (middle.width * K) / 2 - 1;
        tiled(city, W / 2 - gap - (city.width * K) / 2 - shift, H * 0.05, K, W);
        ctx.drawImage(middle, W / 2 - (middle.width * K) / 2 - shift, H * 0.05, middle.width * K, middle.height * K);
      }
      const front = layerOf("bg_a1c5_layer1");
      if (front) {
        const scale = W / front.width;
        tiled(front, (-cam * 25 * K) / 100, H - front.height * scale, scale, W);
      }
    },
    // Background_MountGrowmore::Init, from the Android client. Same build as Protostar, without its far tile layer
    "Mount Growmore"(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_mg_sky", W, H);
      const placed = (tex, x, y) => {
        const image = layerOf(tex);
        if (image) ctx.drawImage(image, x - (image.width * K) / 2, y, image.width * K, image.height * K);
      };
      placed("bg_mg_layer3", W * 0.5, H * -0.1);
      const middle = layerOf("bg_mg_layer2_1");
      const side = layerOf("bg_mg_layer2_2");
      if (middle && side) {
        const gap = (middle.width * K) / 2 + (side.width * K) / 2 - 1;
        const drift = (cam * 5 * K) / 100;
        placed("bg_mg_layer2_1", W * 0.5 - drift, H * 0.05);
        placed("bg_mg_layer2_2", W * 0.5 - gap - drift, H * 0.05);
        placed("bg_mg_layer2_2", W * 0.5 + gap - drift, H * 0.05);
      }
      // AddLayer without w7: scale W / texture width; the aspect flag is on, bottom-left at 1.3H + (W/H - 1.3333) * height
      const front = layerOf("bg_mg_layer1");
      if (front) {
        const scale = W / front.width;
        tiled(front, (-cam * 10 * K) / 100, H * 1.3 + aspectLift(W, H, front.height) - front.height * scale, scale, W);
      }
    },
    // Background_FenyxLock::Init, from the Android client. Scale is H/1080; layers sit bottom-left at H, from order 8000 back
    "Fenyx Lock"(W, H, seconds) {
      const K = H / 1080;
      const cam = Number(camera.value);
      sky("bg_im_sky", W, H);
      // [texture, parallax, drift in units a second]
      [["bg_im_cloud01", 0, -10], ["bg_im_cloud02", 0, -20], ["bg_im_hill", 10, 0], ["bg_im_smalltemple", 20, 0], ["bg_im_foreground3", 0, -30], ["bg_im_foreground2", 30, 0]].forEach(([tex, speed, drift]) => {
        const image = layerOf(tex);
        if (image) tiled(image, (-cam * speed * K) / 100 + drift * K * seconds, H - image.height * K, K, W);
      });
      // Order 10, parallax 15K, at the world's two ends in the client; drawn here at the screen's corners
      const shift = (cam * 15 * K) / 100;
      const left = layerOf("bg_im_cornerleft");
      if (left) ctx.drawImage(left, -shift, H - left.height * K, left.width * K, left.height * K);
      const right = layerOf("bg_im_cornerright");
      if (right) ctx.drawImage(right, W - right.width * K - shift, H - right.height * K, right.width * K, right.height * K);
      // Order 5: stretched over the whole screen
      const fog = layerOf("bg_im_fog");
      if (fog) ctx.drawImage(fog, 0, 0, W, H);
    },
    // Background_RadicalCity::Init, from the Android client. AddLayer without w7 scales to W / texture width, bottom-left at H
    "Radical City"(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_vd_radsky", W, H);
      const fitted = (tex, speed, aspect) => {
        const image = layerOf(tex);
        if (!image) return;
        const scale = W / image.width;
        const bottom = H + (aspect ? aspectLift(W, H, image.height) : 0);
        tiled(image, (-cam * speed * K) / 100, bottom - image.height * scale, scale, W);
      };
      fitted("bg_vd_radrow3", 0, false);
      fitted("bg_vd_radrow2", 10, true);
      // Order 10, scale K, parallax 15K; aligned down-left and down-right at the world's two ends. The client passes
      // y = 0 for these, read here as the bottom of the screen
      const shift = (cam * 15 * K) / 100;
      const left = layerOf("bg_vd_radrow1a");
      if (left) ctx.drawImage(left, -shift, H - left.height * K, left.width * K, left.height * K);
      const right = layerOf("bg_vd_radrow1b");
      if (right) ctx.drawImage(right, W - right.width * K - shift, H - right.height * K, right.width * K, right.height * K);
    },
    // Background_CrackInReality, from the Android client: black, a drifting grid, height-fitted walls and floating rocks
    "Crack In Reality"(W, H, seconds) {
      const K = W / 1024;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const grid = layerOf("bg_cir_layer8");
      if (grid) {
        const scale = 0.75 * K;
        const stepY = grid.height * scale - 2;
        const shift = seconds * scale * 10;
        for (let row = -4; row * stepY < H; row++) tiled(grid, shift, row * stepY, scale, W);
      }
      const left = layerOf("bg_cir_layer1");
      if (left) ctx.drawImage(left, 0, 0, (left.width * H) / left.height, H);
      const right = layerOf("bg_cir_layer2");
      if (right) {
        const w = (right.width * H) / right.height;
        ctx.drawImage(right, W - w, 0, w, H);
      }
      // Top-left at the screen centre plus the offset; Update bobs each by -(sin(pi * (t + phase)) + 1) * 5
      [["bg_cir_layer3", -450, 60, 0], ["bg_cir_layer4", -650, -200, 1.1], ["bg_cir_layer5", 100, -140, 0.7], ["bg_cir_layer6", 90, -410, 1.3], ["bg_cir_layer7", -470, -440, 2.27]].forEach(([tex, x, y, phase]) => {
        const image = layerOf(tex);
        if (!image) return;
        const scale = 0.6 * K;
        const bob = (Math.sin(Math.PI * (seconds + phase)) + 1) * -5;
        ctx.drawImage(image, W / 2 + x * scale, H / 2 + y * scale + bob, image.width * scale, image.height * scale);
      });
    },
    // Background_Protostar::Init, from the Android client. K is W/1024; layers go from order 9000 back to 0 in front
    Protostar(W, H) {
      const K = W / 1024;
      const cam = Number(camera.value);
      sky("bg_stp_sky", W, H);
      const placed = (tex, x, y) => {
        const image = layerOf(tex);
        if (image) ctx.drawImage(image, x - (image.width * K) / 2, y, image.width * K, image.height * K);
      };
      placed("bg_stp_layer4", W * 0.5, H * -0.1);
      // Parallax is field +0x20: 2K here, 10K for layer1, in hundredths of the camera
      tiled(layerOf("bg_stp_layer3"), (-cam * 2 * K) / 100, H * 0.25, K, W);
      const middle = layerOf("bg_stp_layer2_2");
      const side = layerOf("bg_stp_layer2_1");
      if (middle && side) {
        const gap = (middle.width * K) / 2 + (side.width * K) / 2 - 1;
        // Field +0x20 is 5 for these three
        const drift = (cam * 5 * K) / 100;
        placed("bg_stp_layer2_1", W * 0.5 - drift, H * 0.05);
        placed("bg_stp_layer2_2", W * 0.5 - gap - drift, H * 0.05);
        placed("bg_stp_layer2_2", W * 0.5 + gap - drift, H * 0.05);
      }
      // AddLayer with w7 set keeps the scale it was given; aligned bottom-left at 1.5H. The aspect term needs a flag that's off here
      const front = layerOf("bg_stp_layer1");
      if (front) tiled(front, (-cam * 10 * K) / 100, H * 1.5 - front.height * K, K, W);
    },
    // Background_Surgery::Render, copied. Depth ranges of its two cloud sets aren't split further: 10 steps of 0.2
    Surgery(W, H, seconds, dt) {
      const cam = Number(camera.value);
      const k = W / 1024;
      sunnySky(W, H, "#60d7f2");
      sky("su_skybg", W, H);
      const skyline2 = layerOf("su_skyline2");
      if (skyline2) {
        const scale = (W / 2) / skyline2.width;
        ctx.drawImage(skyline2, W / 2 + Math.floor(cam * 0.001 * k), 0, skyline2.width * scale, skyline2.height * scale);
      }
      cloudsOf("cloudsA", "cloud", 10, W, H, dt)(0, 2);
      const tile = (image, step, scale) => {
        if (!image) return;
        let x = Math.floor(cam * -0.1 * k);
        while (x + step < 0) x += step;
        for (; x <= W; x += step) ctx.drawImage(image, x, H - image.height * scale, image.width * scale, image.height * scale);
      };
      const skyline1 = layerOf("su_skyline1");
      if (skyline1) tile(skyline1, W, W / skyline1.width);
      cloudsOf("cloudsB", "cloud", 10, W, H, dt)(0, 2);
      const hill3 = layerOf("su_hill3");
      if (hill3) {
        const scale = W / hill3.width;
        ctx.drawImage(hill3, W * 0.27 + cam * -0.3 * k * 0.5, H - hill3.height * scale, W, hill3.height * scale);
      }
      const hill2 = layerOf("su_hill2");
      if (hill2) {
        const scale = W / hill2.width;
        ctx.drawImage(hill2, W * -0.09 - cam * 0.5 * k * 0.5, H - hill2.height * scale, W, hill2.height * scale);
      }
      const hill1 = layerOf("su_hill1");
      if (hill1) tile(hill1, hill1.width * 0.6 * (W / hill1.width), W / hill1.width);
    },
    // Background_StPatricks::Init and AddShamrock: spinning leaves at 20-50 a second, 0.2-0.3 of their size
    "St Patricks"(W, H, seconds) {
      sky("b_skybg", W, H);
      const rainbow = layerOf("big_rainbow");
      if (rainbow) ctx.drawImage(rainbow, W * 0.66, -H * 0.04, W * 0.28, H * 0.3);
      const sun = layerOf("sun");
      if (sun) ctx.drawImage(sun, W * 0.85 - W / 12, H * 0.15 - W / 12, W / 6, W / 6);
      scaledGround("green_hills3", 0.75, 10, W, H);
      scaledGround("green_hills2", 1, 30, W, H);
      scaledGround("green_hills1", 1.01, 50, W, H);
      // Pot O' Gold, item sprite at column 25, row 5
      const page = layerOf("tiles_page1");
      if (page) ctx.drawImage(page, 25 * 32, 5 * 32, 32, 32, W * 0.67, H * 0.22, W * 0.08, W * 0.08);
      scatterClouds(W, H, seconds, "cloud", null, 4);
      const names = ["shamrock_1", "shamrock_2", "shamrock_3", "shamrock_4", "shamrock_5", "shamrock_6"];
      floaters("leaves", W, H, seconds, 50, names, [24, 36], [20 / 700, 50 / 700], false, (d, x, y, size) => {
        const image = layerOf(d.tex);
        if (!image) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((d.p + seconds * (d.p - 3) * 0.1) * 2);
        ctx.drawImage(image, -size / 2, -size / 2, size, size);
        ctx.restore();
      });
    },
    // Background_IceAge::Init and PopulateAurora
    "Ice Age"(W, H, seconds) {
      sky("icebg_skybg", W, H);
      const aurora = layerOf("icebg_aora");
      if (aurora) {
        const k = W / 1024;
        for (let i = 0; i < 12; i++) {
          ctx.globalAlpha = 0.1 + 0.08 * Math.sin(seconds * 0.5 + i);
          const w = aurora.width * 0.75 * k;
          ctx.drawImage(aurora, (i / 12) * W - w / 4 + Math.cos(seconds * 0.1 + i) * 30 * k, H * 0.02 + Math.sin(seconds * 0.1 + i * 2) * 20 * k, w, H * 0.45);
        }
        ctx.globalAlpha = 1;
      }
      scaledGround("icebg_1", 0.55, 0, W, H);
      ground("icebg_2", 0.95, 30, W, H);
      ground("icebg_3", 1.1, 50, W, H);
    },
    // Background_Volcano::Init
    Volcano(W, H, seconds) {
      sky("mtn_skybg", W, H);
      const u = W / 512;
      ground("mtn_vulbg1", 0.9, 20, W, H);
      ground("mtn_vulbg2", 0.9, 30, W, H);
      ground("mtn_vulbg3", 1.15, 50, W, H);
      ground("mtn_vulbg4", 1.1, 70, W, H);
      drifting("mtn_clouds1", W, 0, 8, u, seconds);
      // Ash from particles2.rttex, drawn here as small pale pieces
      ctx.fillStyle = "rgb(225 225 225 / .85)";
      fallingPieces("ash", 130, () => ({ x: Math.random(), y: Math.random(), s: between(0.02, 0.05), r: between(1.5, 3.5) }), (d) => {
        const size = d.r * (W / 1024);
        ctx.fillRect(((d.x - seconds * 0.01 + 2) % 1) * W, ((d.y + seconds * d.s) % 1) * H, size * 1.4, size);
      });
    },
    // Same layout as the default class, read from Background_Bountiful and Background_Monochrome::Render
    Bountiful: (W, H, seconds, dt) => hillsWeather(W, H, dt, { skyColor: "#00aeef", hills: ["b_hills3", "b_hills2", "b_hills1"] }),
    Monochrome: (W, H, seconds, dt) => hillsWeather(W, H, dt, { skyColor: "#dcdcdc", sunTex: "sun_monochrome", hills: ["hills3_monochrome", "hills2_monochrome", "hills1_monochrome"], cloud: "cloud_monochrome" }),
    "Digital Rain": (W, H, seconds, dt) => digitalRain("drain_skybg", W, H, dt),
    "Black Digital Rain": (W, H, seconds, dt) => digitalRain("bg_black_digital_rain", W, H, dt),
    // Background_Default, used by ids 0, 4 and 23
    Default: (W, H, seconds, dt) => hillsWeather(W, H, dt, { skyColor: "#60d7f2", hills: ["hills3", "hills2", "hills1"] }),
    Sunny: (W, H, seconds, dt) => CUSTOM_SCENES.Default(W, H, seconds, dt),
    // Background_Sunset
    Sunset(W, H, seconds, dt) {
      sky("sunset", W, H);
      const u = W / 512;
      const sun = tintOnce("sun", "#ffa050");
      // Background_Sunset::Render: the sun is W/3 wide
      if (sun) ctx.drawImage(sun, W / 2 - W / 6, H / 2 - W / 6, W / 3, W / 3);
      const water = layerOf("sunset_water");
      if (water) ctx.drawImage(water, 0, H / 2 - 4 * u, W, H / 2 + 4 * u);
      const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.26);
      glow.addColorStop(0, "rgb(255 110 150 / .85)");
      glow.addColorStop(1, "rgb(255 110 200 / 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, H / 2, W, H / 2);
      cloudsOf("clouds", "cloud_red", 20, W, H * 0.5, dt)(0, 1);
    },
    // Background_Desert
    Desert(W, H, seconds) {
      // Background_Desert::Render: fill, sky at height 2/3 H from a 32px texture, sun centred on (W, 0.05H)
      sunnySky(W, H, "#1721b9");
      const skyImage = layerOf("desert_sky");
      if (skyImage) ctx.drawImage(skyImage, 0, 0, W, skyImage.height * (H / 48));
      const sunImage = layerOf("sun");
      if (sunImage) {
        const size = 161 * (W / 1024) * (3 + 0.1 * Math.sin((seconds * 1000 * 6.283) / 4000));
        ctx.globalAlpha = 200 / 255;
        const tinted = tintOnce("sun", "#ffc896");
        ctx.drawImage(tinted, W - size / 2, H * 0.05 - size / 2, size, size);
        ctx.globalAlpha = 1;
      }
      const u = W / 512;
      [["desert_hills2", -36], ["desert_hills", 30]].forEach(([tex, lift], i) => {
        const image = layerOf(tex);
        if (image) tiled(image, -0.2 * (i + 1) * Number(camera.value) * (W / 1024), H + 2 + lift * u - image.height * u, u, W);
      });
    },
    // Background_City: rain falls at a 20 degree slant
    "Rainy City"(W, H, seconds) {
      sky("city_sky", W, H);
      const u = W / 512;
      const line = layerOf("city_skyline");
      if (line) tiled(line, -0.2 * Number(camera.value), H + 2 - line.height * u, u, W);
      ["city_clouds3", "city_clouds2", "city_clouds1"].forEach((tex, i) => drifting(tex, W, -20 * u, 6 * (i + 1), u, seconds));
      ctx.strokeStyle = "rgb(190 210 255 / .35)";
      ctx.lineWidth = Math.max(1, W / 960);
      fallingPieces("rain", 160, () => ({ x: Math.random(), y: Math.random(), s: between(0.8, 1.6) }), (d) => {
        const y = (d.y + seconds * d.s) % 1;
        const x = (d.x - seconds * d.s * 0.2 + 2) % 1;
        ctx.beginPath();
        ctx.moveTo(x * W, y * H);
        ctx.lineTo(x * W - W * 0.006, y * H + H * 0.03);
        ctx.stroke();
      });
    },
    // Background_Harvest
    // Background_Harvest::Render and DrawFence
    Harvest(W, H) {
      sky("sunset", W, H, -10);
      const moon = layerOf("moon2");
      if (moon) {
        const scale = W / 640;
        ctx.drawImage(moon, W - moon.width * scale, H * 0.15, moon.width * scale, moon.height * scale);
      }
      const K = W / 1024;
      const cam = Number(camera.value);
      [["field_back", 1, H + 2 - H / 4, "#000000"], ["field_front", 2, H + 2 - H / 8, "#10180c"]].forEach(([tex, k, top, fill], i) => {
        const image = layerOf(tex);
        if (!image) return;
        const scale = K * k;
        tiled(image, -0.2 * (i + 1) * cam * K, top - image.height * scale, scale, W);
        ctx.fillStyle = fill;
        ctx.fillRect(0, top - K, W, H - top + K);
      });
    },
    // Background_Mars: two tinted moons and black hills
    Mars(W, H, seconds) {
      const scaleY = H / 38;
      const back = layerOf("mars_back");
      if (back) ctx.drawImage(back, 0, -1.5 * scaleY, W, back.height * scaleY);
      starField({ stars: 100 }, W, H, seconds);
      const moon = layerOf("moon");
      if (moon) {
        const a = tintOnce("moon", "#ffc8a0");
        const b = tintOnce("moon", "#ff8080");
        const size = W / 6;
        ctx.drawImage(a, W * 0.1, H * 0.1, size, size);
        ctx.globalAlpha = 0.8;
        ctx.drawImage(b, W * 0.6, H * 0.3, size / 2, size / 2);
        ctx.globalAlpha = 1;
      }
      hillRow(["hills3", "hills2", "hills1"], W, H, "#000000");
    },
    // Background_Spooky
    Spooky(W, H, seconds) {
      sky("evil_sky", W, H, -10);
      const moon = layerOf("moon3");
      if (moon) ctx.drawImage(moon, 0, H * 0.05, moon.width * (W / 1024) * 2, moon.height * (W / 1024) * 2);
      const house = layerOf("spook_house");
      if (house) {
        const k = W / 512;
        ctx.drawImage(house, (128 - Number(camera.value) * 0.03) * (W / 768), H * 0.75 - house.height * k, house.width * k, house.height * k);
      }
      const back = layerOf("field2_back");
      if (back) tiled(back, -0.2 * Number(camera.value), H * 0.75 - back.height * (W / 1024) + H * 0.12, W / 1024, W);
      const front = layerOf("field2_front");
      if (front) tiled(front, -0.4 * Number(camera.value), H + 2 - front.height * (W / 512), W / 512, W);
      const u = W / 512;
      ["city_clouds3", "city_clouds2", "city_clouds1"].forEach((tex, i) => {
        const image = tintOnce(tex, "#b4ffc8");
        if (image) tiled(image, -seconds * 6 * (i + 1) * (W / 1024), -20 * u, u, W);
      });
    },
    // Background_Maw: one spinning twirl
    Maw(W, H, seconds) {
      const image = layerOf("sky_twirl");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      if (!image) return;
      const size = Math.hypot(W, H) * 1.05;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((seconds * 20 * Math.PI) / 180);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
      ctx.restore();
    },
    // Background_Snow
    Snowy(W, H, seconds) {
      sunnySky(W, H, "#45d6f2");
      hillRow(["snowy_hill", "hills2", "hills1"], W, H);
      // Background_Snow::RenderForeground: flakes, then the clouds at scale W/1024 with parallax 0.6
      snowFlakes(W, H, seconds);
      tiled(layerOf("snow_clouds1"), -0.6 * Number(camera.value) * (W / 1024), 0, W / 1024, W);
    },
    // The giant is cut off by the top of the screen; spots are from the client capture, in a 900 wide frame
    // Background_Growch::Render: a cloud layer at -20 before each hill, the last one in front
    Growch(W, H, seconds) {
      sky("city_sky", W, H);
      const u = W / 512;
      const hills = ["snowy_hill", "hills2", "hills1"];
      ["city_clouds3", "city_clouds2", null].forEach((clouds, i) => {
        if (clouds) drifting(clouds, W, -20 * u, 6 * (i + 1), u, seconds);
        const image = layerOf(hills[i]);
        if (image) tiled(image, -0.2 * (i + 1) * Number(camera.value) * (W / 1024), H + 2 + HILL_LIFT[i] * u - image.height * u, u, W);
      });
      growch(W, H, false);
      snowFlakes(W, H, seconds);
      drifting("city_clouds1", W, -20 * u, 18, u, seconds);
    },
    "Growch Happy"(W, H, seconds) {
      sunnySky(W, H, "#45d6f2");
      hillRow(["snowy_hill", "hills2", "hills1"], W, H);
      growch(W, H, true);
      const heart = layerOf("w_heart_01");
      if (heart) floaters("gh", W, H, seconds, 8, ["w_heart_01"], [24, 44], [0.03, 0.07], true, (d, x, y, size) => ctx.drawImage(heart, x, y, size, size));
      snowFlakes(W, H, seconds);
    },
    // Background_NightSnow: dim hills under a dark sky, without a moon or stars
    "Snowy Night"(W, H, seconds) {
      sky("night_back", W, H);
      hillRow(["snowy_hill", "hills2", "hills1"], W, H, "#283246");
      drifting("city_clouds2", W, -24 * (W / 512), 8, W / 512, seconds);
      snowFlakes(W, H, seconds);
    },
    // Background_Undersea: rays hang from the top and fade in and out
    Undersea(W, H, seconds) {
      sky("under_back", W, H);
      const ray = layerOf("water_ray");
      if (!ray) return;
      fallingPieces("rays", 14, () => ({ x: Math.random(), turn: between(-14, 14), width: between(2, 5), phase: Math.random() * 6.3 }), (d) => {
        ctx.save();
        ctx.globalAlpha = 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(seconds * 0.5 + d.phase));
        ctx.translate(d.x * W, 0);
        ctx.rotate((d.turn * Math.PI) / 180);
        const w = ray.width * d.width * (W / 1024);
        ctx.drawImage(ray, -w / 2, 0, w, H * 1.3);
        ctx.restore();
      });
    },
    // Background_Warp: stars pull away from the centre
    Warp(W, H, seconds) {
      sky("warp_back", W, H);
      const sheet = layerOf("stars");
      if (!sheet) return;
      fallingPieces("warp", 180, () => ({ angle: Math.random() * 6.283, phase: Math.random(), speed: between(0.08, 0.3), type: 1 + Math.floor(Math.random() * 6) }), (d) => {
        const t = (d.phase + seconds * d.speed) % 1;
        const reach = t * t * Math.hypot(W, H) * 0.6;
        const size = (4 + 28 * t) * (W / 1024);
        const column = d.type >= 4 ? d.type - 4 : d.type;
        ctx.globalAlpha = Math.min(1, t * 3);
        ctx.drawImage(sheet, column * 16, d.type >= 4 ? 16 : 0, 16, 16, W / 2 + Math.cos(d.angle) * reach - size / 2, H / 2 + Math.sin(d.angle) * reach - size / 2, size, size);
      });
      ctx.globalAlpha = 1;
    },
    // Background_Party: a grid of coloured squares that keep changing, seen on the client
    Party(W, H, seconds) {
      const cell = W / 8.6;
      const rows = Math.ceil(H / cell);
      const cols = Math.ceil(W / cell);
      scene.party ||= Array.from({ length: 200 }, () => ({ from: partyColor(), to: partyColor(), t: Math.random() }));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const p = scene.party[(r * 13 + c) % 200];
        const t = (seconds * 0.5 + p.t) % 1;
        if (t < p.last) { p.from = p.to; p.to = partyColor(); }
        p.last = t;
        ctx.fillStyle = `rgb(${p.from.map((v, i) => Math.round(v + (p.to[i] - v) * t)).join(",")})`;
        ctx.fillRect(c * cell, r * cell, cell + 1, cell + 1);
      }
    },
    // Background_Wolf: its own sky, centred moon and the wolf art over the stars
    Wolf(W, H, seconds) {
      sky("new_sky", W, H);
      starField({ stars: 200, pastel: true }, W, H, seconds);
      const moon = layerOf("moon");
      if (moon) ctx.drawImage(moon, W / 2 - W / 8, H * 0.06 - W / 8, W / 4, W / 4);
      hillRow(["hills3", "hills2", "hills1"], W, H, "#000000");
      // Three wolves, faded differently; spots are from the client capture, in a 900 wide frame
      const wolf = layerOf("sky_wlf");
      if (wolf) {
        const f = W / 900;
        [[265, 430, 240, 0.6, true], [540, 345, 340, 0.3, false], [690, 490, 300, 0.85, false]].forEach(([x, y, size, alpha, flip]) => {
          ctx.save();
          ctx.globalAlpha = alpha * (0.85 + 0.15 * Math.sin(seconds * 0.5 + x));
          ctx.translate(x * f, y * f);
          if (flip) ctx.scale(-1, 1);
          ctx.drawImage(wolf, (-size / 2) * f, (-size / 2) * f, size * f, size * f);
          ctx.restore();
        });
      }
    },
    // Background_Pagoda
    // Background_Pagoda::Render and DrawHill: only the back hill is lifted, by 128 of W/512; parallax 0.2, 0.4, 0.8
    Pagoda(W, H, seconds) {
      sunnySky(W, H, "#0f3c44");
      const skyImage = layerOf("sky_pg");
      if (skyImage) ctx.drawImage(skyImage, 0, 0, W, skyImage.height * (H / 40));
      starField({ stars: 200, pastel: true }, W, H, seconds);
      const moon = layerOf("moon");
      if (moon) ctx.drawImage(moon, W * 0.1, H * 0.1, W / 6, W / 6);
      const u = W / 512;
      const cam = Number(camera.value) * (W / 1024);
      [["hills3_pg", 0.2, -128], ["hills2_pg", 0.4, 0], ["hills1_pg", 0.8, 0]].forEach(([tex, speed, lift], i) => {
        const image = layerOf(tex);
        if (!image) return;
        const bottom = H + 2 + lift * u;
        tiled(image, -speed * cam, bottom - image.height * u, u, W);
        if (i === 0) {
          ctx.fillStyle = "#0a262a";
          ctx.fillRect(0, bottom - 1, W, H);
        }
      });
    },
    // Same class with the sunset and skyline switched on
    Apocalypse: (W, H, seconds, dt) => hazeWeather(W, H, dt, [64, 255, 64], true, true),
    "Purple Haze": (W, H, seconds, dt) => hazeWeather(W, H, dt, [255, 0, 255], false),
    "Fire Haze": (W, H, seconds, dt) => hazeWeather(W, H, dt, [255, 128, 64], false, true),
    "Green Haze": (W, H, seconds, dt) => hazeWeather(W, H, dt, [64, 255, 64], false),
    "Aqua Haze": (W, H, seconds, dt) => hazeWeather(W, H, dt, [0, 255, 255], false),
    "Custom Haze": (W, H, seconds, dt) => hazeWeather(W, H, dt, [255, 128, 64], false),
    // Id 19: flat sky with the Pineapple item falling
    Pineapple(W, H, seconds) {
      sunnySky(W, H, "#6ab4f4");
      const page = layerOf("tiles_page4");
      if (page) floaters("pine", W, H, seconds, 26, ["p"], [24, 72], [0.03, 0.09], false, (d, x, y, size) => ctx.drawImage(page, 9 * 32, 2 * 32, 32, 32, x, y, size, size));
    },
    // Id 29: flat dirt colour with the world's chosen item falling and turning; Dirt is what the client showed
    Stuff(W, H, seconds) {
      sunnySky(W, H, "#8c6235");
      const page = layerOf("tiles_page1");
      if (page) floaters("stuff", W, H, seconds, 26, ["d"], [28, 70], [0.02, 0.06], false, (d, x, y, size) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(seconds * 0.6 + d.p);
        ctx.drawImage(page, 8 * 32, 20 * 32, 32, 32, -size / 2, -size / 2, size, size);
        ctx.restore();
      });
    },
    // Id 34: the world's chosen background tiled over the screen; Cave Background is what the client showed
    Background(W, H) {
      const page = layerOf("tiles_page1");
      if (!page) return;
      const cell = W / 23;
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) ctx.drawImage(page, 25 * 32, 28 * 32, 32, 32, x, y, cell + 1, cell + 1);
    },
    Heart(W, H, seconds) {
      sky("a_heartbg", W, H);
      const sun = layerOf("sun");
      if (sun) ctx.drawImage(sun, W * 0.65, H * 0.82, W / 6, W / 6);
      scatterClouds(W, H * 1.6, seconds, "cloud_red", null, 8);
      const names = ["w_heart_01", "w_heart_02", "w_heart_03", "w_heart_04", "w_heart_05", "w_heart_06"];
      floaters("hearts", W, H, seconds, 42, names, [22, 70], [0.03, 0.08], true, (d, x, y, size) => {
        const image = layerOf(d.tex);
        if (image) ctx.drawImage(image, x, y, size, size);
      });
    },
    // Background_Mascot is Customizable with the world's chosen items floating; those item sprites aren't drawn here
    Mascot: (W, H, seconds, dt) => CUSTOM_SCENES.Default(W, H, seconds, dt),
    // Background_Dungeon: order and scroll from its constructor; rays and sparks use additive blending.
    // The art sits in padded textures, so only its real size is drawn and tiled
    Dungeon(W, H, seconds) {
      sky("dun_forst_bg", W, H);
      const k = W / 1024;
      const cam = Number(camera.value);
      const strip = (tex, realW, realH, speed, top) => {
        const image = layerOf(tex);
        if (!image) return;
        const w = realW * k;
        let x = ((-(cam * speed) / 100) % w + w) % w - w;
        for (; x < W; x += w) ctx.drawImage(image, 0, 0, realW, realH, x, top(realH * k), w, realH * k);
      };
      strip("dun_trees_mainbg", 1000, 701, 2.5, (h) => H - h);
      strip("dun_trees_back1", 1000, 596, 3, (h) => H - h);
      ctx.globalCompositeOperation = "lighter";
      const ray = layerOf("water_ray");
      if (ray) {
        fallingPieces("rays", 8, () => ({ x: Math.random(), width: between(3.5, 6), turn: between(-14, 14), phase: Math.random() * 6.3 }), (d) => {
          ctx.save();
          ctx.globalAlpha = 0.12 + 0.12 * Math.sin(seconds * 0.5 + d.phase);
          ctx.translate(d.x * W, 0);
          ctx.rotate((d.turn * Math.PI) / 180);
          const w = ray.width * d.width * k;
          ctx.drawImage(ray, -w / 2, 0, w, H * 1.2);
          ctx.restore();
        });
      }
      const spark = layerOf("dun_spark1_additive");
      if (spark) {
        fallingPieces("sparks", 40, () => ({ x: Math.random(), y: Math.random(), s: between(0.01, 0.05), size: between(12, 40) }), (d) => {
          const y = 1 - ((d.y + seconds * d.s) % 1);
          ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(seconds + d.x * 20));
          const size = d.size * k;
          ctx.drawImage(spark, d.x * W + Math.sin(seconds * 0.6 + d.y * 9) * 14 - size / 2, y * H, size, size);
        });
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      strip("dun_leaves_ftop", 998, 304, 5.5, () => 0);
      strip("dun_roots_fbot", 1000, 190, 5.5, (h) => H - h);
    },
    // Weather 21 is the default class with its flag set: the hills get tint 0x28ff00ff, stored blue, green, red, alpha
    Spring: (W, H, seconds, dt) => hillsWeather(W, H, dt, { skyColor: "#2482f2", hills: ["hills3", "hills2", "hills1"], tint: "#00ff28" }),
    // Background_Autumn
    Autumn(W, H, seconds) {
      sky("autumnsunset", W, H);
      const sun = layerOf("sun");
      if (sun) ctx.drawImage(sun, W * 0.7, H * 0.1, W / 6, W / 6);
      hillRow(["hills3", "hills2", "hills1"], W, H, "#b08a40");
      scatterClouds(W, H, seconds, "cloud_red", null, 5);
      const front = layerOf("autumn_front");
      if (front) tiled(front, -0.6 * Number(camera.value), H + 2 - front.height * (W / 512), W / 512, W);
    },
    // Background_BalloonWarz
    "Balloon Warz"(W, H, seconds) {
      sunnySky(W, H, "#8edcfb");
      defaultSun(W, H);
      scatterClouds(W, H, seconds);
      const names = ["Balloon_01", "Balloon_02", "Balloon_03", "Balloon_04", "Balloon_05", "Balloon_06"];
      floaters("balloons", W, H, seconds, 36, names, [32, 140], [0.03, 0.09], true, (d, x, y, size) => {
        const image = layerOf(d.tex);
        if (image) ctx.drawImage(image, x, y, size, (size * image.height) / image.width);
      });
    },
    // Background_Jungle: sky, hills and ziggurat, then palms at random spots under fog. The fog colour and the
    // spot list are matched to the client capture, the class builds its list at runtime
    Jungle(W, H, seconds) {
      sky("jungle_sky", W, H);
      const u = W / 512;
      const cam = Number(camera.value);
      const k = W / 1024;
      const hills2 = layerOf("jungle_hills2");
      if (hills2) tiled(hills2, -0.1 * cam, H * 0.5 - hills2.height * u * 1.2, u * 1.2, W);
      const hills = layerOf("jungle_hills");
      if (hills) tiled(hills, -0.2 * cam, H * 1.02 - hills.height * u, u, W);
      const ziggurat = layerOf("jungle_zigarat");

      const palms = [[0.5, 0.3, 0.6, 1], [0.66, 0.34, 0.6, 0], [0.32, 0.5, 0.75, 0], [0.47, 0.42, 0.85, 1], [0.6, 0.5, 0.9, 0], [0.23, 0.22, 1.15, 0], [0.12, 0.66, 0.85, 1], [0.48, 0.62, 0.9, 0], [0.65, 0.65, 0.95, 1], [0.86, 0.68, 0.95, 0]];
      palms.forEach(([x, y, scale, kind]) => {
        const tree = layerOf(kind ? "jungle_tree02" : "jungle_tree");
        if (tree) ctx.drawImage(tree, x * W - (tree.width * scale * k) / 2 - cam * 0.2, y * H, tree.width * scale * k * 1.2, tree.height * scale * k * 1.2);
      });
      ctx.fillStyle = "rgb(35 115 125 / .62)";
      ctx.fillRect(0, 0, W, H);
      if (ziggurat) {
        ctx.globalAlpha = 0.75;
        ctx.drawImage(ziggurat, W * 0.78 - cam * 0.1, H * 0.2, W * 0.26, W * 0.26);
        ctx.globalAlpha = 1;
      }
      const fog = layerOf("haze");
      if (fog) {
        ctx.globalAlpha = 0.45;
        tiled(fog, -seconds * 6 * k, H * 0.8, u, W);
        ctx.globalAlpha = 1;
      }
      const front = layerOf("jungle_forground");
      if (front) tiled(front, -0.4 * cam, H + 2 - front.height * u, u, W);
    },
  };

  // Six-armed flakes with a ring, as in the client
  function snowFlakes(W, H, seconds) {
    ctx.strokeStyle = "rgb(255 255 255 / .9)";
    ctx.lineWidth = Math.max(1, W / 900);
    fallingPieces("snow", 80, () => ({ x: Math.random(), y: Math.random(), s: between(0.04, 0.12), r: between(0.008, 0.016), a: Math.random() * 3 }), (d) => {
      const y = (d.y + seconds * d.s) % 1;
      const x = ((d.x + Math.sin(seconds * 0.4 + d.y * 9) * 0.01 + 1) % 1) * W;
      const r = d.r * W;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const t = d.a + seconds * 0.5 + (i * Math.PI) / 3;
        ctx.moveTo(x - Math.cos(t) * r, y * H - Math.sin(t) * r);
        ctx.lineTo(x + Math.cos(t) * r, y * H + Math.sin(t) * r);
      }
      ctx.moveTo(x + r * 0.6, y * H);
      ctx.arc(x, y * H, r * 0.6, 0, 6.3);
      ctx.stroke();
    });
  }

  function renderLegacy(W, H, dt) {
    const custom = CUSTOM_SCENES[scene.name];
    if (custom) {
      custom(W, H, clock / 1000, dt);
      return;
    }
    if (LAYER_SCENES[scene.name]) {
      renderLayerScene(W, H, LAYER_SCENES[scene.name]);
      return;
    }
    const family = NIGHT_FAMILY[scene.name];
    if (family) {
      renderNightFamily(W, H, family);
      return;
    }
    const cam = Number(camera.value);
    const unit = H / 540;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const stacked = scene.layers.filter((l) => l.kind === "layer" && !(isBackdrop(l) && l.w <= 64));
    scene.layers.forEach((l, index) => {
      const seconds = clock / 1000;
      if (l.kind === "color") {
        ctx.fillStyle = l.color;
        ctx.fillRect(0, 0, W, H);
        return;
      }
      if (l.fit) {
        drawFitted(l, Math.max(0, stacked.indexOf(l)), W, cam, stacked.length);
        return;
      }
      if (l.kind === "layer" && isBackdrop(l) && l.w <= 64) {
        ctx.drawImage(l.image, 0, 0, W, H);
      } else if (l.kind === "stars") {
        const s = 2 * unit;
        for (let x = -((cam * 0.02) % (l.w * s)); x < W; x += l.w * s) for (let y = 0; y < H; y += l.h * s) ctx.drawImage(l.image, x, y, l.w * s, l.h * s);
      } else if (l.kind === "sun" || l.kind === "moon") {
        ctx.drawImage(l.image, W * 0.72 - cam * 0.01, H * 0.08, l.w * unit, l.h * unit);
      } else if (l.kind === "cloud") {
        const w = l.w * unit;
        const count = l.w > 400 ? 1 : 3;
        const span = l.w > 400 ? w : W + w;
        for (let i = 0; i < count; i++) {
          let x = ((seconds * 12 * unit * (1 + index % 3 * 0.4) + (i * span) / count + cam * 0.05) % span);
          x = -x + (l.w > 400 ? 0 : W);
          const y = H * (0.06 + ((index * 13 + i * 37) % 40) / 100);
          ctx.globalAlpha = 0.95;
          ctx.drawImage(l.image, x, y, w, l.h * unit);
          if (l.w > 400) for (let n = x + w; n < W; n += w) ctx.drawImage(l.image, n, y, w, l.h * unit);
        }
        ctx.globalAlpha = 1;
      } else if (l.kind === "float") {
        const size = Math.min(l.w, 120) * unit * 0.6;
        for (let i = 0; i < 6; i++) {
          const x = (W * ((i * 0.19 + index * 0.07) % 1)) ;
          const y = H - ((seconds * 25 * unit + i * H * 0.31) % (H + size));
          ctx.drawImage(l.image, 0, 0, Math.min(l.w, l.h), l.h, x, y, size, size);
        }
      } else {
        // Large art is built for 1080p; older hills are built for a 540p-sized screen
        const scale = (l.h >= 500 || l.w >= 1200 ? H / 1080 : unit);
        const w = l.w * scale;
        const h = l.h * scale;
        const depth = stacked.indexOf(l);
        const y = isBackdrop(l) ? Math.max(0, H - h) : H - h;
        const parallax = stacked.length > 1 ? 0.05 + (depth / (stacked.length - 1)) * 0.4 : 0.1;
        let x = -(cam * parallax % w);
        if (x > 0) x -= w;
        for (; x < W; x += w) ctx.drawImage(l.image, x, y, w, h);
      }
    });
  }

  function drawFrame(dt) {
    if (scene.legacy) renderLegacy(canvas.width, canvas.height, dt);
    else render(dt);
  }

  function tick(now) {
    if (scene) {
      const dt = Math.min((now - last) / 1000, 0.1);
      clock += dt * 1000;
      drawFrame(dt);
    }
    last = now;
    requestAnimationFrame(tick);
  }

  async function show(name) {
    const mine = ++token;
    status.textContent = "Loading weather...";
    try {
      const entry = legacy.find((l) => `legacy:${l.name}` === name);
      const loaded = entry ? await legacyScene(entry) : await parse(name);
      if (mine !== token) return;
      scene = loaded;
      clock = 0;
      status.textContent = "";
    } catch (error) {
      if (mine === token) status.textContent = error.message;
    }
  }

  const label = (name) => name.replace(/([a-z])([A-Z])/g, "$1 $2");

  async function start() {
    try {
      const response = await fetch("assets/weather/list.json");
      if (!response.ok) throw new Error();
      const names = await response.json();
      const more = await fetch("assets/weather/legacy.json");
      legacy = more.ok ? await more.json() : [];
      const group = (title, options) => {
        const el = document.createElement("optgroup");
        el.label = title;
        el.append(...options);
        return el;
      };
      picker.replaceChildren(
        group("Exact layout (XML)", names.map((name) => new Option(label(name), name))),
        group("Approximate layout", legacy.map((l) => new Option(l.name, `legacy:${l.name}`)))
      );
      await show(names[0]);
      requestAnimationFrame((now) => { last = now; tick(now); });
    } catch {
      status.textContent = "The weather list could not be loaded.";
    }
  }

  picker.addEventListener("change", () => show(picker.value));

  // Renders one frame at 1920x1080 for the PNG, then returns to the preview size
  document.getElementById("weather_png").addEventListener("click", () => {
    if (!scene) return;
    const name = picker.value.replace(/^legacy:/, "").replace(/\W+/g, "_");
    const previous = [canvas.width, canvas.height];
    canvas.width = 1920;
    canvas.height = 1205;
    drawFrame(0);
    canvas.toBlob((blob) => GK.download(blob, `weather_${name}.png`), "image/png");
    [canvas.width, canvas.height] = previous;
    drawFrame(0);
  });
  start();
  return { show, draw: drawFrame, get scene() { return scene; } };
})();
