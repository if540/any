/**
 * 站內路徑一律經過 withBase()，GitHub Pages 的 /any 前綴才不會漏掉。
 * withBase('/articles/') → '/any/articles/'
 */
export function withBase(path = '/'): string {
  if (/^(https?:|mailto:|#)/.test(path)) return path;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base && (p === base || p.startsWith(`${base}/`))) return p;
  return `${base}${p}`;
}

/** canonical、og:image、sitemap、JSON-LD 需要含網域與 /any 的完整網址 */
export function absoluteUrl(path: string, site: URL | undefined): string {
  if (/^https?:/.test(path)) return path;
  if (!site) throw new Error('astro.config 需要設定 site');
  return new URL(withBase(path), site).href;
}
