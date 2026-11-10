// 資安專題首頁的 three.js 動態背景。
//
// 畫面的意思：
// - 盾牌與外圍的防護罩：防護
// - 飄浮的字元：防護罩外是不斷變動的密文，飄進防護罩就解密成橘色的明文，飄出去又加密
// - 外圍的線框：四維超立方體（tesseract）投影到三維，呼應「次元」
// - 所有物件緩慢漂移、翻轉：無重力
//
// 無障礙：畫面純裝飾（canvas 設 aria-hidden）；提供暫停鈕；
// 使用者設定「減少動態效果」時預設不播放，只畫一張靜止畫面；離開視窗或切換分頁時停止運算。
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, EdgesGeometry, ExtrudeGeometry,
  Fog, Group, IcosahedronGeometry, Line, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Points, PointsMaterial, Scene, Shape, Sprite, SpriteMaterial, TorusGeometry,
  Vector3, WebGLRenderer, WireframeGeometry,
} from 'three';

const ORANGE = 0xff6b1a;
const WHITE = 0xfafaf7;
const BLACK = 0x111111;

const CIPHER = '0123456789ABCDEF#$%&@?';
const PLAIN = 'SAFEDATAKEYTRUST';
const FIELD_R = 2.7; // 防護罩半徑：字元進到這個範圍內就「解密」

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function glyphMaterial(ch: string, color: string, opacity: number): SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 46px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(ch, 32, 35);
  return new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, opacity, depthWrite: false });
}

function shieldShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 1.6);
  s.quadraticCurveTo(0.7, 1.25, 1.3, 1.15);
  s.lineTo(1.3, 0.1);
  s.bezierCurveTo(1.3, -0.9, 0.6, -1.4, 0, -1.75);
  s.bezierCurveTo(-0.6, -1.4, -1.3, -0.9, -1.3, 0.1);
  s.lineTo(-1.3, 1.15);
  s.quadraticCurveTo(-0.7, 1.25, 0, 1.6);
  return s;
}

function keyhole(z: number, material: LineBasicMaterial): Line {
  const pts: Vector3[] = [];
  // 上半圓，接下方的梯形
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI * 0.32 + (i / 24) * Math.PI * 1.64;
    pts.push(new Vector3(Math.cos(a) * 0.3, 0.3 + Math.sin(a) * 0.3, z));
  }
  pts.push(new Vector3(-0.24, -0.62, z), new Vector3(0.24, -0.62, z), pts[0].clone());
  return new Line(new BufferGeometry().setFromPoints(pts), material);
}

// 四維超立方體：16 個頂點、32 條邊
const TESS_V: number[][] = [];
for (let i = 0; i < 16; i++) TESS_V.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const TESS_E: [number, number][] = [];
for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) if (!(i & (1 << b))) TESS_E.push([i, i | (1 << b)]);

export function initSecurityHero(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-hero-toggle]')!;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch {
    return; // 沒有 WebGL：保留靜態的盾牌圖
  }
  renderer.setClearColor(BLACK);

  const scene = new Scene();
  scene.fog = new Fog(BLACK, 8, 19);
  const camera = new PerspectiveCamera(42, 1, 0.1, 60);
  camera.position.set(0, 0, 10);

  // 盾牌、防護罩、陀螺環、超立方體都放在同一個群組，一起在畫面右側飄浮
  const core = new Group();
  scene.add(core);

  // ── 盾牌 ──
  const shield = new Group();
  const shieldGeo = new ExtrudeGeometry(shieldShape(), { depth: 0.3, bevelEnabled: false, curveSegments: 20 });
  shieldGeo.translate(0, 0, -0.15);
  shield.add(new Mesh(shieldGeo, new MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.1, depthWrite: false })));
  const orangeLine = new LineBasicMaterial({ color: ORANGE });
  shield.add(new LineSegments(new EdgesGeometry(shieldGeo, 30), orangeLine));
  const inner = new LineSegments(new EdgesGeometry(shieldGeo, 30), new LineBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.45 }));
  inner.scale.set(0.78, 0.78, 1.3);
  shield.add(inner);
  const whiteLine = new LineBasicMaterial({ color: WHITE });
  shield.add(keyhole(0.17, whiteLine), keyhole(-0.17, whiteLine));
  core.add(shield);

  // ── 防護罩 ──
  const fieldMat = new LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0.14 });
  const field = new LineSegments(new WireframeGeometry(new IcosahedronGeometry(FIELD_R, 1)), fieldMat);
  core.add(field);

  // ── 陀螺環 ──
  const rings: Mesh[] = [];
  [[3.15, ORANGE, 0.9], [3.45, WHITE, 0.35], [3.8, ORANGE, 0.5]].forEach(([r, color, opacity], i) => {
    const ring = new Mesh(
      new TorusGeometry(r, 0.012, 6, 160),
      new MeshBasicMaterial({ color, transparent: true, opacity }),
    );
    ring.rotation.set(i * 1.1, i * 0.7, 0);
    rings.push(ring);
    core.add(ring);
  });

  // ── 四維超立方體 ──
  const tessPos = new Float32Array(TESS_E.length * 6);
  const tessGeo = new BufferGeometry();
  tessGeo.setAttribute('position', new BufferAttribute(tessPos, 3));
  const tess = new LineSegments(tessGeo, new LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0.22 }));
  core.add(tess);
  const proj = new Float32Array(16 * 3);
  function updateTesseract(t: number) {
    const a = t * 0.23, b = t * 0.17;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    for (let i = 0; i < 16; i++) {
      const [x, y, z, w] = TESS_V[i];
      const x1 = x * ca - w * sa, w1 = x * sa + w * ca; // 在 XW 平面旋轉
      const y1 = y * cb - z * sb, z1 = y * sb + z * cb; // 在 YZ 平面旋轉
      const k = 3.4 / (2.6 - w1); // 從第四維往三維做透視投影
      proj[i * 3] = x1 * k * 1.9; proj[i * 3 + 1] = y1 * k * 1.9; proj[i * 3 + 2] = z1 * k * 1.9;
    }
    TESS_E.forEach(([p, q], i) => {
      tessPos.set(proj.subarray(p * 3, p * 3 + 3), i * 6);
      tessPos.set(proj.subarray(q * 3, q * 3 + 3), i * 6 + 3);
    });
    tessGeo.attributes.position.needsUpdate = true;
  }

  // ── 遠方的光點 ──
  const starPos = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) starPos.set([rand(-16, 16), rand(-9, 9), rand(-12, -2)], i * 3);
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new BufferAttribute(starPos, 3));
  scene.add(new Points(starGeo, new PointsMaterial({ color: WHITE, size: 0.035, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false })));

  // ── 飄浮的字元 ──
  const cipherMats = [...CIPHER].map((ch) => glyphMaterial(ch, '#fafaf7', 0.5));
  const plainMats = [...PLAIN].map((ch) => glyphMaterial(ch, '#ff6b1a', 1));
  const randCipher = () => cipherMats[(Math.random() * cipherMats.length) | 0];
  const BOX = { x: 9.5, y: 4.6, zMin: -4, zMax: 3 };
  type Glyph = { sprite: Sprite; vel: Vector3; phase: number; plain: SpriteMaterial; inside: boolean; flickerUntil: number; nextSwap: number };
  const glyphs: Glyph[] = [];
  const glyphCount = window.innerWidth < 640 ? 70 : 130;
  for (let i = 0; i < glyphCount; i++) {
    const sprite = new Sprite(randCipher());
    sprite.position.set(rand(-BOX.x, BOX.x), rand(-BOX.y, BOX.y), rand(BOX.zMin, BOX.zMax));
    const size = rand(0.26, 0.42);
    sprite.scale.set(size, size, 1);
    sprite.userData.size = size;
    scene.add(sprite);
    glyphs.push({
      sprite,
      vel: new Vector3(rand(-0.28, 0.28), rand(-0.16, 0.16), rand(-0.12, 0.12)),
      phase: rand(0, Math.PI * 2),
      plain: plainMats[i % plainMats.length],
      inside: false, flickerUntil: 0, nextSwap: rand(0, 1.5),
    });
  }

  const corePos = new Vector3();
  function updateGlyphs(t: number, dt: number) {
    core.getWorldPosition(corePos);
    for (const g of glyphs) {
      const p = g.sprite.position;
      p.addScaledVector(g.vel, dt);
      p.y += Math.sin(t * 0.5 + g.phase) * 0.0016; // 無重力的輕微浮動
      if (p.x > BOX.x) p.x = -BOX.x; else if (p.x < -BOX.x) p.x = BOX.x;
      if (p.y > BOX.y) p.y = -BOX.y; else if (p.y < -BOX.y) p.y = BOX.y;
      if (p.z > BOX.zMax) p.z = BOX.zMin; else if (p.z < BOX.zMin) p.z = BOX.zMax;

      const inside = p.distanceTo(corePos) < FIELD_R;
      if (inside !== g.inside) { g.inside = inside; g.flickerUntil = t + 0.4; } // 穿過防護罩：亂碼閃一下再定下來
      if (t < g.flickerUntil) {
        if (t > g.nextSwap) { g.sprite.material = randCipher(); g.nextSwap = t + 0.05; }
      } else if (inside) {
        g.sprite.material = g.plain;
      } else if (t > g.nextSwap) {
        g.sprite.material = randCipher();
        g.nextSwap = t + rand(0.3, 1.4);
      }
      const s = (g.sprite.userData.size as number) * (inside ? 1.35 : 1);
      g.sprite.scale.set(s, s, 1);
    }
  }

  // ── 版面：寬螢幕把盾牌放右側，讓出左邊給標題 ──
  let wide = true;
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    wide = w / h > 1.25;
    camera.position.z = wide ? 10 : 13.5;
    camera.updateProjectionMatrix();
    if (!running) draw(0);
  }

  // 滑鼠視差
  const pointer = { x: 0, y: 0 };
  root.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });
  root.addEventListener('pointerleave', () => { pointer.x = pointer.y = 0; });

  let time = 14; // 從一個構圖好看的時間點開始，靜止畫面也用這一格
  function draw(dt: number) {
    time += dt;
    const t = time;
    core.position.set(wide ? 3.1 : 0, (wide ? 0.1 : 1.5) + Math.sin(t * 0.45) * 0.18, 0);
    shield.rotation.set(Math.sin(t * 0.31) * 0.16, Math.sin(t * 0.22) * 0.55, Math.sin(t * 0.27) * 0.07);
    field.rotation.set(t * 0.05, t * 0.08, 0);
    fieldMat.opacity = 0.12 + Math.sin(t * 1.2) * 0.04;
    rings[0].rotation.x += dt * 0.32; rings[0].rotation.y += dt * 0.11;
    rings[1].rotation.y -= dt * 0.24; rings[1].rotation.z += dt * 0.09;
    rings[2].rotation.x -= dt * 0.13; rings[2].rotation.z -= dt * 0.19;
    updateTesseract(t);
    updateGlyphs(t, dt);
    camera.position.x += (pointer.x * 0.6 - camera.position.x) * 0.04;
    camera.position.y += (-pointer.y * 0.35 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  // ── 播放控制 ──
  let wantPlay = !reduced.matches; // 使用者的意願（按鈕）
  let visible = true;              // 是否在視窗內、分頁是否在前景
  let running = false;
  let last = 0;
  let raf = 0;
  function frame(now: number) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    const should = wantPlay && visible && !document.hidden;
    if (should && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    if (!should && running) { running = false; cancelAnimationFrame(raf); }
    toggle.setAttribute('aria-pressed', String(!wantPlay));
    toggle.querySelector('[data-label]')!.textContent = wantPlay ? '暫停動畫' : '播放動畫';
    root.dataset.playing = String(wantPlay);
  }
  toggle.addEventListener('click', () => { wantPlay = !wantPlay; sync(); });
  toggle.hidden = false;
  document.addEventListener('visibilitychange', sync);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }).observe(root);
  new ResizeObserver(resize).observe(root);

  // 先讓幾個字元有機會落在防護罩內，靜止畫面才看得出「解密」
  resize();
  for (let i = 0; i < 4; i++) {
    const p = glyphs[i].sprite.position;
    core.getWorldPosition(corePos);
    p.set(corePos.x + rand(-1.6, 1.6), corePos.y + rand(-1.4, 1.4), rand(0.4, 1.6));
  }
  draw(0);
  draw(0.5); // 跑過穿越時的閃爍，讓靜止畫面顯示明文
  root.classList.add('is-ready');
  sync();
  // 給測試用：固定在某個時間點重畫
  (root as HTMLElement & { __draw?: (dt: number) => void }).__draw = draw;
}
