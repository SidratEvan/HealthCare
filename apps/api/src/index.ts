// Express + Socket.IO server (BACKEND.md §3).
//
// Step 3 (feat/api-foundation) adds env, db, logger, the middleware chain,
// error codes and the health routes. The directory layout is fixed by
// BACKEND.md §3 and the layering rule in packages/config/eslint/layering.mjs:
//
//   routes → controllers → services → repositories → config/db
//
// SQL lives only in repositories; events and notifications only in services.
export {};
