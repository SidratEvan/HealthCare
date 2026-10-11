# Platform, Import and National checkpoint

11 October 2026. Root branch `feat/console-redesign-platform-import-national`, resumed from `b20ffd9` and the predecessor's dirty Platform work. All changes remain local. No new dependencies, migration, hosting, push or merge.

Platform preserves onboarding, manual BMDC review, lifecycle, agreement/modules/domain and aggregate health/audit reads. Shared frame, Help, organisation search/filters, four retained workspace sections, explicit scoped write review and unsaved navigation guards are implemented. Created credentials remain a once-only handover; uncertain creation requires authoritative lookup before another submission. A lost password response cannot recover that password. Domain/write errors remain visible across sections.

Import preserves CSV/XLSX templates, analysis, manual mappings, preview/errors/warnings, approval, history and audited all-or-none operations. Shared frame/Help and stage guide retain the selected file/mapping. Failed reads preserve prior history; uncertain writes disable new writes and navigation until authoritative batch readback. Network failure is distinct from the browser being offline, so readback remains possible after a lost reply.

National preserves the four aggregate-only APIs, independent freshness/failed reads and suppression already present. The district filter affects district cards, not national totals. Hour cells are keyboard-selectable with current aggregate details and accessible hour headers. No patient, facility identity or new API drill-down is introduced. Geographic boundary data, extra feeds/metrics and the C10 small-cohort privacy decision remain outside this local design completion.

## C8 safety and explicit limits

All three file doors authenticate before their own bounded JSON parser. Actual CSV UTF-8 is limited to five MiB; escaped JSON has its separate bound. The global 256KiB parser no longer preempts analysis/mapped upload.

Commit seals full-row digests (including precise timestamps) in existing batch metadata after all rows. Undo serializes import writes per hospital, locks templates before sessions and touched rows, and validates all after-states/dependencies before writing. Missing legacy evidence, later edits/use/aliases block the whole transaction. Adopted departments/doctor memberships are classified as updates; replacement schedule Undo restores its original reference. Staff fingerprints also cover roles.

Imported doctor and staff updates have incomplete linked chamber/role preimages; their whole-batch Undo is deliberately refused and explained in bilingual Help/history. Review such changes in existing Settings. Legacy batches also refuse. Timestamp comparison is intentionally conservative: undoing a later batch does not guarantee an older batch becomes undoable. This is not a generic rollback or production readiness claim.

Focused results: UTF-8 six cases; Import/mapping API 52/52; expanded persisted-state Import 29/29; coordinated alias-versus-Undo one case passed. The final affected Import file then passed **30/30, 20.34 seconds, exit 0** on final safety source, in `accelerated-handover-import-focused.log`. Four new workspace browser cases pass with zero retries (2.4 minutes), including axe, tablet captures, unsaved/Help, filtered national totals, failed refresh and committed lost-reply reconciliation. All four also passed after final visual refinements in the interrupted full gate. Initial red runs retained in ignored `accelerated-resume-*.log` files; no retry/exclusion/timeout policy weakened.

Representative captures: `platform-tablet-draft.png`, `national-tablet-hour.png`, `import-tablet-preview.png`. Implementation is local in `dea893f` and `9afb1d8`; latest regenerated PNGs remain uncommitted for inspection. Consolidated gates were interrupted, not completed; repository/build/built/production and corrected original Platform checks remain pending. The main completion checkpoint records the usage-limit handover, failures and exact continuation commands.
