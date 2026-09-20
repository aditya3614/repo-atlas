import type { Summary } from './protocol';

/**
 * The bundled demo: the real history of axios, an MIT-licensed project with
 * 1,987 non-merge commits (2,192 including merges).
 *
 * Shipped as plain text, not gzipped: static servers set Content-Encoding on a
 * .gz file, the browser then decompresses it transparently, and the worker's
 * own gunzip would be handed plain text. Transport compression handles the
 * wire anyway. The worker's .gz path stays for files people drop themselves.
 */
export const DEMO = {
  url: `${import.meta.env.BASE_URL}demo/axios-history.txt`,
  repo: 'axios',
  attribution: {
    repo: 'axios/axios',
    url: 'https://github.com/axios/axios',
    license: 'MIT',
  } satisfies NonNullable<Summary['attribution']>,
};
