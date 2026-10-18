# Console design foundation — Phase 8B Batch 1

Branch: `feat/console-redesign-foundation`, based on `mvp ca88c478`.

This is an opt-in React foundation for the eleven founder-approved console prototypes. Existing workspaces, routing, authentication, clinical forms, API contracts, queue hooks, outboxes and patient styles remain unchanged. No backend fixes from Phase 8A are included. No push, merge or deployment is authorised for this batch.

## What is available

- `shared/ui/src/console/ConsoleFoundation.tsx`: scoped theme, bilingual actions/labels, hospital header, role-filtered navigation presentation, shell/page header/panels, existing labelled inputs, fixed semantic statuses, inline feedback, loading/empty/error/offline state blocks, static contextual Help and guarded confirmation dialogs.
- `shared/ui/src/console/foundation.css`: the prototypes' cool canvas/navy text, 92 px desktop rail, rectangular actions, 8/12/16 px radii, spacing tokens, readable focus/disabled states and tablet layout. Status colours are fixed and cannot be supplied through the brand interface.
- `frontend/console/src/components/ConsoleWorkspaceFrame.tsx`: unused-by-V1 adapter for existing `DemoSession` and hospital branding (`loadBrand`, `brandKept`, `logoOf`). It filters the caller's role/module choices, rejects restricted-session navigation, avoids drawing a previous hospital's brand and leaves global document colour variables untouched. The existing authenticated parent must still own access gates and routing; the component is not an authorisation boundary.
- `shared/i18n/src/messages.ts`: Bangla/English foundation labels and three short Help instructions about field guidance, language selection and closing Help. Full role/workflow help belongs to later batches.

The shared package exports the new components through `@platform/ui`. Consumers explicitly import `@platform/ui/console.css` and mount `ConsoleTheme`; no global stylesheet or existing screen has been migrated. Radix portals carry the scoped brand so Help/confirmation dialogs do not fall back to the previous palette. Help keeps the form mounted, traps keyboard focus, supports Escape and restores focus. Dialog keys do not bubble into a workspace's window shortcuts. Confirmations require an explicit safe exit and never infer server success. Pending actions suppress callback/form submission; disabled actions show their reason.

The appearance is compatible with reception, doctor, admin, access-registration, ward, emergency, lab, pharmacy, platform-onboarding, data-import and national prototypes. Each workspace still needs its own approved composition and production data wiring in a later batch. No synthetic prototype state machine is copied into production.

## Local preview and screenshots

The component review is separate from Next routes and does not contact an API or database. It uses the existing installed React, Tailwind, Radix, Playwright and axe tooling, and fonts already produced by the console's `next/font` build. Its synthetic Shapla identity is explicitly marked Demo; fields contain design-review text, never patient data. Only the local component example can change, and nothing is persisted.

```powershell
pnpm.cmd build
node frontend/console/preview-foundation.mjs
# Open http://127.0.0.1:3210
```

To reproduce the browser verification and screenshots:

```powershell
node frontend/console/preview-foundation.mjs --check
```

Generated bundles and detailed verification JSON are under ignored `.cache/console-foundation-preview/`. Review PNGs are in this directory: desktop, landscape and portrait in Bangla/English, corresponding Help panels and a second brand. Verification checks real rendered contrast/axe, page overflow, Help focus/form retention, fixed status colours across brands, portalled theme, confirmation dismissal, 200% zoom and unchanged existing primitives outside the theme. It checks for browser errors and any request outside the local preview origin.

## Verification and limitations

Baseline and final command results are recorded in `docs/STATUS.md`. Use `.cmd` for pnpm on this PowerShell host; its `.ps1` shim is blocked by execution policy. Initial parallel Vitest runs encountered worker-start timeouts; these are tooling failures, not passing test runs. The initial build could not fetch the existing Google Fonts under restricted network access; the requested build is verified with that download permission, without changing font configuration.

This batch is a Focused UI gate. It does not certify the clinical modules or resolve Phase 8A's note/sign/replay/socket/lab/pharmacy/import safety findings. No production provider, live environment or real patient workflow is tested by the component preview. Later adoption must retain current test IDs, server permissions, freshness and module-specific offline rules. The full release and production-config gates remain mandatory before deployment/real use.

## Next batch

After founder review, the next proposed UI batch is staff access/role landing using this foundation. Authentication behavior and routing were deliberately left intact here. The Phase 8A socket/access safety work remains a separate gate before clinical rollout; it has not been implemented or disguised by this presentation work. Reception, Registration, Doctor and other module redesigns have not begun.

Rollback of this batch removes the new exports/adapter/opt-in CSS; it requires no API/schema/data/store rollback.

## File inventory

Created:

- `shared/ui/src/console/ConsoleFoundation.tsx`
- `shared/ui/src/console/foundation.css`
- `shared/ui/src/console/__tests__/foundation.test.tsx`
- `shared/ui/src/console/__tests__/tokens.test.ts`
- `shared/ui/src/console/__preview__/FoundationPreview.tsx`
- `frontend/console/src/components/ConsoleWorkspaceFrame.tsx`
- `frontend/console/preview-foundation.mjs`
- This README and thirteen review PNGs in `docs/design/console-foundation/`.

Modified:

- `shared/ui/src/index.ts` and `shared/ui/package.json` (component/CSS exports only; no dependencies added).
- `shared/i18n/src/messages.ts` (new keys only; existing copy retained).
- `docs/FRONTEND.md` and `docs/STATUS.md` (approved direction, current state and verification evidence).

The earlier untracked `docs/reports/` and `.claude/` work is excluded from this batch's commit.
