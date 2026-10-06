// 文章的自動封面：/og/articles/<slug>.png
import type { APIContext } from 'astro';
import { authorNames } from '../../../consts';
import { getArticles, type Article } from '../../../utils/content';
import { renderCover, pngResponse } from '../../../utils/og';

export async function getStaticPaths() {
  const posts = await getArticles();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export async function GET({ props }: APIContext) {
  const { post } = props as { post: Article };
  return pngResponse(await renderCover({
    seed: post.id,
    kicker: 'ARTICLE',
    title: post.data.coverTitle ?? post.data.title,
    motif: post.data.coverMotif,
    tags: post.data.tags,
    byline: authorNames(post.data.authors),
  }));
}
