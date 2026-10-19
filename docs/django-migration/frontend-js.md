# The web apps in JavaScript

Phase 5 of the migration brief (18 October): the frontend's TypeScript became
JavaScript, for a maintainer who reads Python and JavaScript. The screens, the
copy in both languages, the layouts, the accessibility and every request and
socket message are what they were: the conversion removed types and changed
nothing else.

## What was converted, and what was not

| Package | Now | Why |
|---|---|---|
| `frontend/console` | JavaScript (`.js`, `.jsx`) | A web app |
| `frontend/patient` | JavaScript | A web app |
| `frontend/site` (`src/`) | JavaScript | A web app |
| `shared/ui` | JavaScript | Used only by the web apps |
| `shared/client` | JavaScript | Used only by the web apps |
| `shared/domain` | **TypeScript, unchanged** | The Node API runs the same files, and the Django port's parity vectors are generated from them (`tests/parity`). The web apps import it as before. |
| `shared/i18n` | **TypeScript, unchanged** | The Node API's messages read it |
| `e2e/`, `frontend/site/tests/` | **TypeScript, unchanged** | The browser specs are the acceptance test for both APIs and both frontends; changing them while they judge the change would weaken them |

The Node API (`backend/api`) stays TypeScript: it is the reference the Django
API is measured against.

## How it was done

`scripts/ts-to-js.mjs`, run once. The TypeScript compiler removes the types
and nothing else: JSX is kept as written, the target is ESNext so no syntax is
lowered, and comments stay. Blank lines are carried through the compile, a
`./x.js` import of what was `x.tsx` now names `./x.jsx`, and Prettier formats
the result with the repository's rules. One file held only types and was
removed (`frontend/patient/src/lib/types.ts`).

Lost with the types: the documentation that lived on interfaces and type
aliases (the comments on a removed type go with it).

## What replaced the compiler's guarantees

- **Lint, without type information** (`shared/config/eslint/base.mjs`, the
  JavaScript block): undefined names, unused code, import cycles and
  duplicates, no console, the package boundaries (`layering.mjs`). The rules
  that needed types (floating promises, exhaustive switches, `any`) cannot
  run on JavaScript and are gone for these packages.
- **The runtime validation that was already there stays**: the zod schemas
  in `shared/domain` (still TypeScript) that the forms and the server share,
  and the API client's envelope check (`shared/client/src/api/client.js`).
- **New: the live serial channel checks what it is sent.**
  `isQueueStatement` and `isQueueEvent` (`shared/client/src/realtime/session.js`)
  drop a `queue.updated` or `queue.event` that is not the shape the queue
  engine sends, so the screen keeps the last state it could trust and its
  freshness line ages, rather than drawing a queue from a malformed message.
  This mattered more once a second server could be the one sending.
- **The tests**: the unit and component tests of these packages, converted
  with them, and every browser spec, unchanged.

## What changed around the code

- `tsconfig.json` became `jsconfig.json` in the three apps (it gives `@/` to
  Next and editors); `shared/ui` and `shared/client` have none. Their
  `typecheck` scripts are gone; `frontend/site` type-checks its browser tests
  only (`tests/tsconfig.json`).
- `shared/ui` and `shared/client` export `./src/index.js`.
- `vitest.config.ts` collects `.js` and `.jsx` tests.
- The documents (`FRONTEND.md`, `APP_FLOW.md`) still name some files `.ts`
  or `.tsx`; on this branch the same file is `.js` or `.jsx`.
