# frontend/console — Hospital console (Part B)

Next.js App Router, desktop-first (1280px baseline), keyboard-first, offline-first.
Screens and wiring: `docs/APP_FLOW.md` Part B (`S-B-00` … `S-B-13`).
Keyboard map: `docs/APP_FLOW.md` D4.

Scaffolded in **step 8 (`feat/console-reception`)** with the reception queue
(`S-B-02`), the Dexie offline event queue and the optimistic reducer imported
from `@platform/domain` — the same reducer the API runs, which is what stops
the console and the server ever disagreeing about the queue (FR-QUE-05).
