/**
 * 傳參數試算：依 Claude Code 文件的規則，在瀏覽器裡模擬 skill 參數替換。
 * https://code.claude.com/docs/en/skills#available-string-substitutions
 * - $ARGUMENTS：整串原樣
 * - $ARGUMENTS[N]／$N：依位置（從 0 開始），引號內的空白不切；沒有對應參數時原樣留著
 * - $name：frontmatter arguments 宣告的名字，依順序對應位置；沒有對應值時變成空字串
 * - \$1 這種單一反斜線會跳脫，不替換
 * - 沒有任何佔位符收到參數時，在最後補「ARGUMENTS: <輸入>」
 */
const PRESETS: Record<string, { body: string; names: string; args: string }> = {
  index: { body: 'Migrate the $0 component from $1 to $2.\nPreserve all existing behavior and tests.', names: '', args: 'SearchBar JavaScript TypeScript' },
  named: { body: 'Check out $branch, then fix issue #$issue.', names: 'issue branch', args: '123 hotfix/login' },
  none: { body: 'Explain what this file does for a new teammate.', names: '', args: 'src/auth.ts' },
};

/** 類似 shell 的切法：空白分隔，引號內的空白不切 */
export function splitArgs(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

type Piece = { text: string; sub?: boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 回傳替換後的片段（sub = 被替換進去的值）與切好的參數 */
export function substitute(body: string, raw: string, names: string[]) {
  const args = splitArgs(raw);
  const pieces: Piece[] = [];
  let received = false;
  let last = 0;

  const valid = names.filter((n) => /^[A-Za-z_][\w-]*$/.test(n)).sort((a, b) => b.length - a.length);
  const namePart = valid.length ? `|(${valid.map(escapeRe).join('|')})(?![\\w-])` : '';
  const re = new RegExp(String.raw`(\\*)\$(ARGUMENTS\[(\d+)\]|ARGUMENTS|(\d+)` + namePart + ')', 'g');

  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [all, slashes, token, idxA, idxN, name] = m;
    pieces.push({ text: body.slice(last, m.index) });
    last = m.index + all.length;
    // 單一反斜線：跳脫，輸出 $token 本身
    if (slashes.length === 1) { pieces.push({ text: `$${token}` }); continue; }
    if (slashes) pieces.push({ text: slashes });
    if (token === 'ARGUMENTS') { pieces.push({ text: raw, sub: true }); received = true; continue; }
    const idx = idxA ?? idxN;
    if (idx !== undefined) {
      const v = args[Number(idx)];
      if (v === undefined) pieces.push({ text: `$${token}` });
      else { pieces.push({ text: v, sub: true }); received = true; }
      continue;
    }
    if (name) { pieces.push({ text: args[valid.length ? names.indexOf(name) : -1] ?? '', sub: true }); received = true; }
  }
  pieces.push({ text: body.slice(last) });
  if (raw.trim() && !received) pieces.push({ text: '\n\n' }, { text: `ARGUMENTS: ${raw}`, sub: true });
  return { pieces, args };
}

export function initArgPlayground(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>('[data-cs-play]');
  if (!box) return;
  const body = box.querySelector<HTMLTextAreaElement>('[data-play-body]');
  const names = box.querySelector<HTMLInputElement>('[data-play-names]');
  const args = box.querySelector<HTMLInputElement>('[data-play-args]');
  const out = box.querySelector<HTMLElement>('[data-play-out]');
  const vars = box.querySelector<HTMLElement>('[data-play-vars]');
  if (!body || !names || !args || !out || !vars) return;
  const presetButtons = [...box.querySelectorAll<HTMLButtonElement>('[data-preset]')];
  box.hidden = false;

  const run = () => {
    const nameList = names.value.trim() ? names.value.trim().split(/[\s,]+/) : [];
    const { pieces, args: list } = substitute(body.value, args.value, nameList);
    out.replaceChildren(...pieces.map((p) => {
      if (!p.sub) return document.createTextNode(p.text);
      const mark = document.createElement('mark');
      mark.textContent = p.text || '（空字串）';
      if (!p.text) mark.className = 'is-empty';
      return mark;
    }));
    const rows: [string, string][] = [['$ARGUMENTS', args.value || '（空）']];
    list.forEach((v, i) => rows.push([`$${i}`, v]));
    nameList.forEach((n, i) => rows.push([`$${n}`, list[i] ?? '（空字串）']));
    vars.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }));
  };

  const load = (key: string) => {
    const p = PRESETS[key];
    body.value = p.body;
    names.value = p.names;
    args.value = p.args;
    presetButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === key)));
    run();
  };
  presetButtons.forEach((b) => b.addEventListener('click', () => load(b.dataset.preset ?? 'index')));
  [body, names, args].forEach((el) => el.addEventListener('input', () => {
    presetButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    run();
  }));
  load('index');
}
