/**
 * Builds the API suite's database on its own, outside vitest
 * (`docs/django-migration/testing.md`): migrations, the demo seed, and the
 * API's login role. The target is `DATABASE_URL_API_TEST`, which must name a
 * local database ending in `_test`.
 */

import setup from './api-global-setup.js';

await setup();
console.log(`built ${process.env['DATABASE_URL_API_TEST'] ?? '(default API test database)'}`);
