import { AUTHORS, type AuthorKey } from '../consts';
import { withBase } from './url';

/** JSON-LD 裡的作者 @id，全站一致才能被搜尋引擎串起來 */
export const personId = (key: AuthorKey, home: string) => `${home}#author-${key}`;

/** 作者在關於頁的錨點連結 */
export const authorHref = (key: AuthorKey) => withBase(`/about/#${key}`);

export function personLd(key: AuthorKey, home: string): Record<string, unknown> {
  const a = AUTHORS[key];
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': personId(key, home),
    name: a.name,
    description: a.bio,
    url: `${home}about/#${key}`,
    sameAs: a.sameAs,
  };
}
