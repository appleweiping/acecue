// AceCue — premium 3D hero scene. "Hear the question, see the answer."
//
// A flowing audio-waveform ribbon travels left → right across the scene.
// Question-mark glyph particles drift in along the ribbon and dissolve into
// a soft "answer" glow on the right, where the DOM glass overlay card sits.
//
// Constraints honoured here:
//   - Three.js loaded ONLY via the pinned CDN importmap ("three"), lazily.
//   - pixelRatio capped at 2; render loop pauses when tab hidden or hero
//     scrolled out of view.
//   - Graceful fallback: if WebGL is unavailable, reduced motion is preferred,
//     or the CDN import fails, we bail silently and the CSS gradient hero
//     remains. The page is fully usable without this module.

let state = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// Read brand colors from the live CSS custom properties so the scene follows
// the light/dark theme exactly.
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    accent: cs.getPropertyValue("--accent").trim() || "#4f6cff",
    accent2: cs.getPropertyValue("--accent-2").trim() || "#3a8fb7",
    dark,
  };
}

// Tiny deterministic value-noise (no deps) for organic ribbon displacement.
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const h = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  return h(i) * (1 - u) + h(i + 1) * u;
}

// Canvas-drawn "?" sprite texture (white glyph → tinted by material color).
function makeGlyphTexture(THREE) {
  const s = 96;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, s, s);
  ctx.font = `700 ${s * 0.72}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // soft halo
  ctx.shadowColor = "rgba(255,255,255,.9)";
  ctx.shadowBlur = s * 0.12;
  ctx.fillStyle = "#fff";
  ctx.fillText("?", s / 2, s / 2 + s * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Radial-gradient glow sprite texture for the "answer" bloom.
function makeGlowTexture(THREE) {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,.95)");
  g.addColorStop(0.35, "rgba(255,255,255,.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ribbon centreline: a gentle S-curve crossing the viewport.
function ribbonY(x, t) {
  return (
    Math.sin(x * 0.32 + t * 0.7) * 0.9 +
    Math.sin(x * 0.13 - t * 0.35) * 0.55 +
    (noise1(x * 0.22 + t * 0.18) - 0.5) * 1.1
  );
}

export async function initHero(canvas) {
  if (!canvas || state) return false;
  if (prefersReducedMotion() || !webglAvailable()) return false;

  let THREE;
  try {
    THREE = await import("three");
  } catch {
    return false; // CDN unreachable → keep static gradient hero
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 13);

  let colors = themeColors();
  const cAccent = new THREE.Color(colors.accent);
  const cAccent2 = new THREE.Color(colors.accent2);

  // ---- waveform ribbon: a long thin plane, vertices displaced per frame ----
  const SEG_X = 220, SEG_Y = 10, W = 30, H = 2.4;
  const ribbonGeo = new THREE.PlaneGeometry(W, H, SEG_X, SEG_Y);
  const pos = ribbonGeo.attributes.position;
  const colAttr = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
  ribbonGeo.setAttribute("color", colAttr);
  const ribbonMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: colors.dark ? 0.5 : 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  scene.add(ribbon);

  // two crisp waveform lines hugging the ribbon edges
  const LINE_PTS = 240;
  const mkLine = (opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LINE_PTS * 3), 3));
    const m = new THREE.LineBasicMaterial({ color: cAccent.clone(), transparent: true, opacity });
    const l = new THREE.Line(g, m);
    scene.add(l);
    return l;
  };
  const lineA = mkLine(0.85);
  const lineB = mkLine(0.5);

  // ---- "?" glyph particles drifting along the ribbon ----
  const P_COUNT = 110;
  const glyphTex = makeGlyphTexture(THREE);
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(P_COUNT * 3);
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    map: glyphTex,
    color: cAccent.clone(),
    size: 0.55,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);
  // per-particle progress 0..1 along the journey + lane offsets
  const pT = new Float32Array(P_COUNT);
  const pLane = new Float32Array(P_COUNT);
  const pSpeed = new Float32Array(P_COUNT);
  for (let i = 0; i < P_COUNT; i++) {
    pT[i] = Math.random();
    pLane[i] = (Math.random() - 0.5) * 2.4;
    pSpeed[i] = 0.035 + Math.random() * 0.05;
  }

  // ---- answer glow where particles converge (under the DOM glass card) ----
  const glowTex = makeGlowTexture(THREE);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: cAccent2.clone(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(glowMat);
  const CONVERGE = new THREE.Vector3(6.2, 0.6, 0.5);
  glow.position.copy(CONVERGE);
  glow.scale.setScalar(5);
  scene.add(glow);
  const glow2 = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex, color: cAccent.clone(), transparent: true,
      opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  glow2.position.copy(CONVERGE);
  glow2.scale.setScalar(2.4);
  scene.add(glow2);

  // ---- theme reactivity ----
  const applyTheme = () => {
    colors = themeColors();
    cAccent.set(colors.accent);
    cAccent2.set(colors.accent2);
    lineA.material.color.set(colors.accent);
    lineB.material.color.set(colors.accent2);
    pMat.color.set(colors.accent);
    glowMat.color.set(colors.accent2);
    glow2.material.color.set(colors.accent);
    ribbonMat.opacity = colors.dark ? 0.5 : 0.38;
    paintRibbonColors();
  };
  const themeObserver = new MutationObserver((muts) => {
    if (muts.some((m) => m.attributeName === "data-theme")) applyTheme();
  });
  themeObserver.observe(document.documentElement, { attributes: true });

  function paintRibbonColors() {
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const f = (x + W / 2) / W; // 0 left → 1 right
      tmp.copy(cAccent).lerp(cAccent2, f);
      // fade horizontal edges so the ribbon dissolves at viewport bounds…
      const edgeX = Math.min(1, Math.min(f, 1 - f) * 6);
      // …and fade the band vertically so it glows at the centre, not a slab
      const row = Math.floor(i / (SEG_X + 1));
      const edgeY = Math.pow(1 - Math.abs(row / SEG_Y - 0.5) * 2, 1.6);
      const a = edgeX * (0.15 + 0.85 * edgeY);
      colAttr.setXYZ(i, tmp.r * a, tmp.g * a, tmp.b * a);
    }
    colAttr.needsUpdate = true;
  }
  paintRibbonColors();

  // ---- parallax ----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e) => {
    const w = window.innerWidth, h = window.innerHeight;
    pointer.tx = (e.clientX / w - 0.5) * 2;
    pointer.ty = (e.clientY / h - 0.5) * 2;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  // ---- resize ----
  const resize = () => {
    const r = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  // ---- visibility-aware render loop ----
  let raf = 0, running = false, inView = true, t0 = performance.now();
  let elapsed = 0;

  const frame = (now) => {
    raf = running ? requestAnimationFrame(frame) : 0;
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    elapsed += dt;
    const t = elapsed;

    // ribbon displacement
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const v = Math.floor(i / (SEG_X + 1)); // row index 0..SEG_Y
      const lane = (v / SEG_Y - 0.5) * H;
      const y = ribbonY(x * 0.55, t) + lane * (0.7 + 0.3 * Math.sin(x * 0.4 + t));
      const z = Math.sin(x * 0.18 + t * 0.5) * 0.8 + lane * 0.35;
      pos.setY(i, y);
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;

    // waveform edge lines
    const la = lineA.geometry.attributes.position;
    const lb = lineB.geometry.attributes.position;
    for (let i = 0; i < LINE_PTS; i++) {
      const f = i / (LINE_PTS - 1);
      const x = -W / 2 + f * W;
      const amp = Math.sin(f * Math.PI); // taper at both ends
      const y = ribbonY(x * 0.55, t);
      la.setXYZ(i, x, y + Math.sin(x * 2.1 + t * 3.2) * 0.22 * amp, 0.9);
      lb.setXYZ(i, x, y - Math.sin(x * 1.7 - t * 2.6) * 0.3 * amp, -0.6);
    }
    la.needsUpdate = true;
    lb.needsUpdate = true;

    // glyph particles: travel along ribbon, converge + fade into the glow
    for (let i = 0; i < P_COUNT; i++) {
      pT[i] += pSpeed[i] * dt * 2.2;
      if (pT[i] > 1) { pT[i] = 0; pLane[i] = (Math.random() - 0.5) * 2.4; }
      const f = pT[i];
      const x0 = -W / 2 + f * W * 0.72; // stop short of the right edge
      // ease toward convergence point in the last 25% of the journey
      const k = f < 0.75 ? 0 : (f - 0.75) / 0.25;
      const ease = k * k * (3 - 2 * k);
      const x = x0 * (1 - ease) + CONVERGE.x * ease;
      const y = (ribbonY(x0 * 0.55, t) + pLane[i] * (1 - ease)) * (1 - ease) + CONVERGE.y * ease;
      const z = Math.sin(x0 * 0.18 + t * 0.5) * (1 - ease) + CONVERGE.z * ease;
      pPos[i * 3] = x;
      pPos[i * 3 + 1] = y + Math.sin(t * 1.4 + i) * 0.06;
      pPos[i * 3 + 2] = z;
    }
    pGeo.attributes.position.needsUpdate = true;

    // glow breathing
    const breathe = 1 + Math.sin(t * 1.6) * 0.08;
    glow.scale.setScalar(5 * breathe);
    glow2.scale.setScalar(2.4 * (2 - breathe));
    glowMat.opacity = 0.45 + Math.sin(t * 1.6) * 0.1;

    // camera parallax (lerped)
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    camera.position.x = pointer.x * 0.9;
    camera.position.y = -pointer.y * 0.6;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  };

  const start = () => {
    if (running || !inView || document.hidden) return;
    running = true;
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVis);

  const io = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      inView ? start() : stop();
    },
    { threshold: 0.02 }
  );
  io.observe(canvas);

  state = { renderer, stop, themeObserver, io };
  start();
  canvas.classList.add("is-live");
  return true;
}
