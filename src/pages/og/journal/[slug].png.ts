// 日誌的自動分享圖：/og/journal/<slug>.png
import type { APIContext } from 'astro';
import { authorNames } from '../../../consts';
import { getJournal, type Journal } from '../../../utils/content';
import { renderCover, pngResponse } from '../../../utils/og';

export async function getStaticPaths() {
  const entries = await getJournal();
  return entries.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}

export async function GET({ props }: APIContext) {
  const { entry } = props as { entry: Journal };
  return pngResponse(await renderCover({
    seed: entry.id,
    kicker: 'JOURNAL',
    title: entry.data.coverTitle ?? entry.data.title,
    motif: entry.data.coverMotif,
    tags: entry.data.tags,
    byline: authorNames(entry.data.authors),
  }));
}
