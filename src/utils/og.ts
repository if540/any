// build 時自動產生封面／分享圖（1200×630 PNG）
// satori 把版面排成 SVG，resvg 再轉成 PNG。字型用 Noto Sans TC（devDependency）。
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { MOTIF_NAMES, type MotifName } from '../consts';

const require = createRequire(import.meta.url);
const fontPath = (w: string) =>
  require.resolve(`@expo-google-fonts/noto-sans-tc/${w}/NotoSansTC_${w}.ttf`);

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 700 | 900; style: 'normal' }[]> | undefined;
const loadFonts = () =>
  (fontsPromise ??= Promise.all([
    readFile(fontPath('700Bold')).then((data) => ({ name: 'Noto Sans TC', data, weight: 700 as const, style: 'normal' as const })),
    readFile(fontPath('900Black')).then((data) => ({ name: 'Noto Sans TC', data, weight: 900 as const, style: 'normal' as const })),
  ]));

const C = { orange: '#ff6b1a', black: '#111111', white: '#fafaf7', gray: '#a8a8a8' };

// 幾何符號：frontmatter 的 coverMotif 可指定；沒指定就依 slug 固定挑一個

const MOTIFS: Record<MotifName, string> = {
  // 串接的方塊（連結、組合）
  chain: `<rect x="20" y="110" width="70" height="70" fill="none" stroke="${C.white}" stroke-width="10"/>
   <rect x="125" y="110" width="70" height="70" fill="none" stroke="${C.white}" stroke-width="10"/>
   <rect x="230" y="110" width="70" height="70" fill="${C.orange}" stroke="${C.white}" stroke-width="10"/>
   <path d="M90 145h35M195 145h35" stroke="${C.orange}" stroke-width="10"/>`,
  // 同心圓（焦點、目標）
  target: `<circle cx="160" cy="160" r="130" fill="none" stroke="${C.white}" stroke-width="10"/>
   <circle cx="160" cy="160" r="85" fill="none" stroke="${C.white}" stroke-width="10"/>
   <circle cx="160" cy="160" r="38" fill="${C.orange}"/>`,
  // 3×3 格子（版面、表格）
  grid: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) =>
    `<rect x="${30 + c * 95}" y="${30 + r * 95}" width="70" height="70" fill="${r === 1 && c === 2 ? C.orange : 'none'}" stroke="${C.white}" stroke-width="10"/>`)).join(''),
  // 偏移陰影的堆疊卡片（文件、文章）
  stack: `<rect x="70" y="70" width="200" height="200" fill="${C.orange}"/>
   <rect x="40" y="40" width="200" height="200" fill="${C.black}" stroke="${C.white}" stroke-width="10"/>
   <path d="M80 110h120M80 150h120M80 190h70" stroke="${C.white}" stroke-width="10"/>`,
  // 角括號（程式碼）
  code: `<path d="M110 70 30 160l80 90M210 70l80 90-80 90" fill="none" stroke="${C.white}" stroke-width="14" stroke-linecap="square"/>
   <path d="M185 50 135 270" stroke="${C.orange}" stroke-width="14"/>`,
  // 長短不一的長條（數據、效能）
  bars: [120, 200, 80, 260, 160].map((h, i) =>
    `<rect x="${20 + i * 58}" y="${290 - h}" width="40" height="${h}" fill="${i === 3 ? C.orange : 'none'}" stroke="${C.white}" stroke-width="10"/>`).join(''),
};

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.codePointAt(0)!) >>> 0, 7);

const motifSrc = (seed: string, motif?: MotifName) => {
  const name = motif ?? MOTIF_NAMES[hash(seed) % MOTIF_NAMES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">${MOTIFS[name]}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

export interface CoverInput {
  seed: string;          // 通常是 slug
  kicker: string;        // ARTICLE / JOURNAL
  title: string;          // 可用 \n 指定換行位置
  tags?: string[];
  motif?: MotifName;
  byline?: string;       // 作者名
}

const el = (type: string, style: Record<string, unknown>, children?: unknown) =>
  ({ type, props: { style, children } });

export async function renderCover({ seed, kicker, title, tags = [], byline, motif }: CoverInput): Promise<Buffer> {
  const lines = title.split('\n');
  const len = Math.max(...lines.map((l) => [...l].length));
  const titleSize = len <= 14 ? 88 : len <= 24 ? 72 : 60;

  const tree = el('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column',
    background: C.black, color: C.white, fontFamily: 'Noto Sans TC',
    padding: '64px 72px 0', position: 'relative',
  }, [
    // 上排：類別 + 標籤
    el('div', { display: 'flex', alignItems: 'center', gap: 16, fontSize: 26, fontWeight: 700 }, [
      el('div', { color: C.orange, letterSpacing: 6 }, kicker),
      ...tags.slice(0, 3).map((t) => el('div', { border: `3px solid ${C.white}`, padding: '0 14px', fontSize: 22 }, t)),
    ]),
    // 標題
    el('div', {
      display: 'flex', flexDirection: 'column', marginTop: 36, width: 760, fontSize: titleSize, fontWeight: 900,
      lineHeight: 1.25, letterSpacing: -1,
    }, lines.map((l) => el('div', { display: 'flex' }, l))),
    // 幾何符號
    { type: 'img', props: { src: motifSrc(seed, motif), width: 300, height: 300, style: { position: 'absolute', right: 70, top: 150 } } },
    // 底部：品牌 + 作者
    el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      position: 'absolute', left: 72, right: 72, bottom: 60,
    }, [
      el('div', { display: 'flex', alignItems: 'flex-end', fontSize: 56, fontWeight: 900, letterSpacing: -2 }, [
        el('div', {}, 'any'),
        el('div', { width: 16, height: 16, background: C.orange, marginLeft: 6, marginBottom: 14 }),
      ]),
      el('div', { fontSize: 26, fontWeight: 700, color: C.gray }, byline ?? ''),
    ]),
    // 橘色底線
    el('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24, background: C.orange }),
  ]);

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: await loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

export const pngResponse = (png: Buffer) =>
  new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
