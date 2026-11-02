// Plays the game's WeatherRenderers XML files on a canvas. The XML format has no public documentation,
// so units here (screen fractions, per-second particle speeds, 1080p padding) are read from how the files use them.
const Weather = (() => {
  const box = document.getElementById("weather_box");
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

  function renderLegacy(W, H) {
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
    if (scene.legacy) renderLegacy(canvas.width, canvas.height);
    else render(dt);
  }

  function tick(now) {
    if (box.open && scene) {
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
    canvas.height = 1080;
    drawFrame(0);
    canvas.toBlob((blob) => GK.download(blob, `weather_${name}.png`), "image/png");
    [canvas.width, canvas.height] = previous;
    drawFrame(0);
  });
  let started = false;
  box.addEventListener("toggle", () => {
    if (box.open && !started) {
      started = true;
      start();
    }
  });
  return { show, draw: drawFrame, get scene() { return scene; } };
})();
