// 無障礙技能樹：把「網站無障礙規範」的成功準則，和文章的 wcag 欄位對應起來
import guideData from '../data/a11y-guide.json';
import { getArticles, type Article } from './content';

export type Level = 'A' | 'AA' | 'AAA';

export const LEVEL_LABEL: Record<Level, string> = { A: '基礎', AA: '進階', AAA: '傳說' };
export const MAX_STARS = 5;
interface GuideCriterion { id: string; name: string; level: string; guideline: string; principle: string; text: string; obsolete?: boolean }
const guide = guideData as { source: string; principles: typeof guideData.principles; guidelines: typeof guideData.guidelines; criteria: GuideCriterion[] };

export const GUIDE_SOURCE = guide.source;
/** 規範列出的全部編號（含已刪除的 4.1.1）與實際成為技能的準則 */
export const OBSOLETE_CRITERIA = guide.criteria.filter((c) => c.obsolete).map((c) => ({ id: c.id, name: c.name }));
export const GUIDE_TOTAL = guide.criteria.length;

export interface SkillArticle { id: string; title: string }

export interface Skill {
  id: string;            // 4.1.3
  slug: string;          // 4-1-3
  name: string;
  level: Level;
  guideline: string;
  principle: string;
  text: string;          // 規範原文
  articles: SkillArticle[];
  stars: number;         // 0（未解鎖）～ 5
}

export interface GroupStat { unlocked: number; total: number; avgStars: number }

export interface Guideline { id: string; name: string; summary: string; skills: Skill[]; stat: GroupStat }
export interface Principle { id: string; name: string; summary: string; guidelines: Guideline[]; stat: GroupStat }

export interface Achievement {
  id: string;
  name: string;
  condition: string;
  earned: boolean;
  group: 'milestone' | 'principle' | 'guideline';
}

export interface SkillTree {
  principles: Principle[];
  skills: Skill[];
  stat: GroupStat;
  maxArticles: number;
  achievements: Achievement[];
}

export const toSlug = (id: string) => id.replaceAll('.', '-');

/**
 * 星級：對數歸一。以「文章最多的那一項」為 5 星，
 * stars = round(5 × log(1 + n) / log(1 + nMax))，已解鎖至少 1 星。
 */
export function starsFor(n: number, nMax: number): number {
  if (n <= 0 || nMax <= 0) return 0;
  const s = Math.round((MAX_STARS * Math.log1p(n)) / Math.log1p(nMax));
  return Math.min(MAX_STARS, Math.max(1, s));
}

const stat = (skills: Skill[]): GroupStat => ({
  unlocked: skills.filter((s) => s.stars > 0).length,
  total: skills.length,
  // 平均星數：未解鎖算 0 星，代表這個群組整體的熟練度
  avgStars: skills.length ? Math.round((skills.reduce((t, s) => t + s.stars, 0) / skills.length) * 10) / 10 : 0,
});

export async function getSkillTree(): Promise<SkillTree> {
  const articles: Article[] = await getArticles();

  const bySc = new Map<string, SkillArticle[]>();
  for (const a of articles) {
    for (const id of a.data.wcag ?? []) {
      if (!bySc.has(id)) bySc.set(id, []);
      bySc.get(id)!.push({ id: a.id, title: a.data.title });
    }
  }
  const maxArticles = Math.max(0, ...[...bySc.values()].map((v) => v.length));

  // 規範標示「因過時而刪除」的準則（4.1.1）不列為技能
  const skills: Skill[] = guide.criteria.filter((c) => !c.obsolete).map((c) => {
    const list = bySc.get(c.id) ?? [];
    return {
      id: c.id,
      slug: toSlug(c.id),
      name: c.name,
      level: c.level as Level,
      guideline: c.guideline,
      principle: c.principle,
      text: c.text,
      articles: list,
      stars: starsFor(list.length, maxArticles),
    };
  });

  const principles: Principle[] = guide.principles.map((p) => {
    const guidelines: Guideline[] = guide.guidelines
      .filter((g) => g.id.startsWith(`${p.id}.`))
      .map((g) => {
        const gs = skills.filter((s) => s.guideline === g.id);
        return { id: g.id, name: g.name, summary: g.summary, skills: gs, stat: stat(gs) };
      });
    const ps = skills.filter((s) => s.principle === p.id);
    return { id: p.id, name: p.name, summary: p.summary, guidelines, stat: stat(ps) };
  });

  const total = stat(skills);
  const byLevel = (lv: Level[]) => skills.filter((s) => lv.includes(s.level));
  const allOn = (list: Skill[]) => list.length > 0 && list.every((s) => s.stars > 0);
  const nA = byLevel(['A']).length;
  const nAA = byLevel(['A', 'AA']).length;
  const half = Math.ceil(skills.length / 2);

  const achievements: Achievement[] = [
    { id: 'first', name: '初次點亮', condition: '解鎖第 1 項技能', earned: total.unlocked >= 1, group: 'milestone' },
    { id: 'ten', name: '十項技能', condition: '解鎖 10 項技能', earned: total.unlocked >= 10, group: 'milestone' },
    { id: 'five-star', name: '五星技能', condition: '任一技能達到 5 顆星', earned: skills.some((s) => s.stars === MAX_STARS), group: 'milestone' },
    { id: 'legend', name: '傳說初現', condition: '解鎖第 1 項 AAA 傳說技能', earned: byLevel(['AAA']).some((s) => s.stars > 0), group: 'milestone' },
    { id: 'half', name: '過半', condition: `解鎖 ${half} 項技能`, earned: total.unlocked >= half, group: 'milestone' },
    { id: 'badge-a', name: 'A 級標章', condition: `${nA} 項 A 級技能全部解鎖`, earned: allOn(byLevel(['A'])), group: 'milestone' },
    { id: 'badge-aa', name: 'AA 級標章', condition: `A 與 AA 級共 ${nAA} 項全部解鎖`, earned: allOn(byLevel(['A', 'AA'])), group: 'milestone' },
    { id: 'badge-aaa', name: 'AAA 級標章', condition: `${skills.length} 項技能全部解鎖`, earned: allOn(skills), group: 'milestone' },
    ...principles.map((p) => ({
      id: `p-${p.id}`, name: `${p.name}守護者`, condition: `原則 ${p.id}「${p.name}」全部解鎖`,
      earned: allOn(skills.filter((s) => s.principle === p.id)), group: 'principle' as const,
    })),
    ...principles.flatMap((p) => p.guidelines).map((g) => ({
      id: `g-${g.id}`, name: `${g.id} ${g.name}`, condition: `指引 ${g.id} 的 ${g.skills.length} 項技能全部解鎖`,
      earned: allOn(g.skills), group: 'guideline' as const,
    })),
  ];

  return { principles, skills, stat: total, maxArticles, achievements };
}

/** 給螢幕閱讀器的完整描述 */
export const skillLabel = (s: Skill) =>
  `${s.id} ${s.name}，${s.level} ${LEVEL_LABEL[s.level]}技能，` +
  (s.stars > 0 ? `已解鎖，${s.stars} 顆星，${s.articles.length} 篇文章` : '尚未解鎖');
