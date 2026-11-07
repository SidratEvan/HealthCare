# Laboratory and Pharmacy checkpoint

Updated 11 October 2026. Local branch `feat/console-redesign-lab-pharmacy`, based on `9b2337e`. Resumed predecessor uncommitted screens; no completed earlier module was rebuilt. User accelerated-completion instruction overrides historical per-module approval/merge rules. No push, merge, deployment, new dependency or migration.

Implemented: existing branded console frame, bilingual Help, test/stage/search filters, hidden patient labels, cancellation review, selected-file upload review and stable retry key. Pharmacy derives the public answer from the original domain clock, distinguishes the recorded flag from its public answer, searches/filters and reviews confirmation against the full source shelf. Whole-list confirmation above 200 rows is visibly withheld; individual existing-stock writes remain available. No dispensing, medicine catalogue administration or diagnostic booking added.

Narrow clinical corrections are isolated from presentation:

- **C5 / DB-P7:** successful identifying lab reads await an existing durable `RECORD_VIEW` audit with staff, hospital, patient and test-order identity. Audit failure returns an error without the label. Role, hospital and RLS checks remain.
- **C6 / FR-LAB-03:** canonical base64, nonempty decoded bytes, exact 10 MiB ceiling and existing PDF/JPEG/PNG/WebP magic-byte sniffing are checked before storage. Replay must belong to the same test order, including concurrent cross-order requests serialized by the existing advisory-key helper. Object paths include a content digest so racing bodies cannot overwrite committed bytes. Storage still precedes the database transaction; unreferenced-object cleanup remains a separate operational limit.
- **C7 / FR-PHR-02:** PUT flags now require `expectedUpdatedAt` (the exact shelf `updatedAt` string, or null for an absent flag). GET preserves PostgreSQL six-digit UTC microseconds. A hospital advisory transaction lock and row locks compare the complete submitted list before changing anything. Stale/duplicate/unavailable-medicine lists refuse with `WRITE_CONFLICT`; the console reloads and asks staff to review again. Existing 1–200 bound remains; requests are never silently split. Changes need coordinated API/console rollout; older clients without versions fail closed.

Focused evidence so far:

| Check | Actual result |
| --- | --- |
| API/domain/console TypeScript | Passed all three affected packages. Final console check after write guards/Help: direct `node node_modules/typescript/bin/tsc --noEmit -p frontend/console/tsconfig.json` passed. The direct command avoids a PowerShell/pnpm stderr wrapper reporting failure on the `$ tsc --noEmit` status line. |
| Unit selectors and lab/stock domain | 3 files / 33 tests passed. |
| Original Lab routes plus safety routes | Corrected run: 2 files / 53 tests passed, 68.82 seconds, disposable localhost `healthcare_api_test`, limited API role. Includes audit failure, tenant refusal, malformed/MIME/10 MiB validation, order-key replay/race, exact-version stock comparison, stale/concurrent/all-or-none writes, duplicates/missing versions/>200. |
| Lint/format | Direct ESLint passed all 14 changed TypeScript paths with zero warnings. Targeted formatting checked at final checkpoint. Initial unfinished-source issues (missing header title/unused import/order) corrected. |
| E2E TypeScript | Only pre-existing `import-mapping.spec.ts:308` error (`suggestedByModel` on never); no error in the changed lab browser spec. Root owns Import fixes. |
| Browser/build | Root will run the integrated gate; no browser/build pass claimed here. Original `lab-report.spec.ts` adapted for upload/review buttons; focused filters/hidden-row confirmation/conflict/retry/Help/tablet/offline cases added. Four representative captures are produced by the tablet case when executed. |

Initial API attempt stopped before collection because worktree bootstrap lacked DATABASE_URL. A later 50/52 run failed two new test assumptions: existing RLS intentionally hides foreign orders with 404; key reuse is existing 422. Assertions corrected to these established protections, no code/error policy weakened. Root supplies only documented localhost disposable defaults; no remote env copied.

Next: finish targeted lint/format and UI checkpoint; send exact local commit/path inventory to root. Root will integrate explicit files (union shared UI package exports), execute browser smoke and inspect representative captures, then run one consolidated full gate. Clinical checkpoint and presentation checkpoint are separate. No clinical production-readiness claim. Existing clinician-access, orphan cleanup, provider/storage activation and physical hospital rehearsal remain separate gates.
