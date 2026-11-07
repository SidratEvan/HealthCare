# Audit progress checklist

## Phase 0 — discovery
- [x] Branches, worktrees, stashes, uncommitted work inventoried (README §1.1)
- [x] Newest code located (`fix/release-audit-2026-10-11` @ `8eec772`)
- [x] Deployed demo and live site mapped to commits
- [x] Other agents' worktrees checked; nothing of theirs modified
- [x] Audit branch cut; pre-existing uncommitted screenshots preserved (stash + copy)

## Phase 1–2 — audit and independent testing
- [x] Baseline: typecheck, lint, format, 8,081 unit/API/schema tests
- [x] Dependency audit, tracked-file secret scan
- [ ] Baseline: development browser suite (`pnpm test:e2e`)
- [x] Static review: auth, authorisation, DB scope, realtime, files, exports, idempotency, locking, sync, timers, env, headers, frontend storage
- [x] Independent probes: patient answers, replay keys, capacity race, malformed input on every route, counter race
- [x] Deployment configuration rendered and checked
- [ ] Backup and restore drill (local, synthetic)

## Phase 3 — initial report
- [x] FINDINGS.md, README.md (initial), MATRIX.md

## Phase 4 — remediation
- [ ] F-01 patient answers anonymised
- [ ] F-05 compose passes SMS and payment settings
- [ ] F-04 production refuses Supabase storage
- [ ] F-02 replay keys bound to their chamber
- [ ] F-06 lint heap
- [ ] F-11 deploy example corrected

## Phase 5 — second audit
- [ ] Full `pnpm verify` on the fixed code
- [ ] Development browser suite on the fixed code
- [ ] Production-configuration browser suite (`pnpm test:e2e:prod`)
- [ ] Built-console suite (`pnpm test:e2e:built`)
- [ ] Review of the fixes themselves

## Phase 6 — verdict
- [ ] README §6 verdict and conditions
- [ ] `docs/STATUS.md` updated
