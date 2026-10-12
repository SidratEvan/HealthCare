/**
 * Where the company site is served. `SITE_ORIGIN` overrides it for a preview
 * deployment, so canonical links never point a preview at itself.
 */
export const SITE_ORIGIN = (process.env['SITE_ORIGIN'] ?? 'https://medlivebd.com').replace(
  /\/$/,
  '',
);
