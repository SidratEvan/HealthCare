# Traceability matrix — workflow → evidence → remaining risk

Evidence columns name tests that **ran in this audit** (baseline and after
fixes). "Existing" means the project's own suite; "Audit" means written for
this audit. A workflow is not marked verified because code exists.

Legend: ✅ verified by a run in this audit · ⚠️ verified with a stated limit ·
❌ defect found (see FINDINGS) · — not verifiable here.

## Patient app

| Workflow | Requirement IDs | Evidence | Result | Remaining risk |
|---|---|---|---|---|
| Discover hospitals, doctors, chambers | FR-PAT-16–19 | `search.routes`, `patient-search.spec` | ✅ | — |
| Guest booking with phone proof | FR-GST-01–05, FR-GST-03 | `booking.routes`, `guest-phone-proof.spec`, `guest-booking.spec` | ✅ | Needs live SMS on a real server ([F-11](FINDINGS.md#f-11)) |
| Capacity under concurrent booking | FR-PAT-20 | Audit: *twelve simultaneous guests* | ✅ | — |
| Same doctor twice in a day refused | FR-PAT-24 | `booking.routes` | ✅ | — |
| Live serial updates < 2 s | FR-PAT-31 | `two-device-queue.spec` (canary) | ✅ | Real 3G and real devices not measured |
| What a patient is sent of the queue | FR-NET-02, FR-SEC-11 | `realtime`, `liveSerial.routes`, Audit *F-01* | ❌→ fix | [F-01](FINDINGS.md#f-01) |
| Cancel, running late | FR-PAT-23, FR-PAT-33 | `liveSerial.routes`, Audit *F-01* | ✅ (after fix) | — |
| Standby list and offers | FR-PAT-25–27, FR-QUE-30 | `standby.routes`, `standbySelfServe.routes`, `standby.spec` | ✅ | Lapsed offer does not pass on by itself (owner's question 14) |
| My serials, accounts, claiming | FR-PAT-01, -04, FR-GST-09/12 | `patientAuth.routes`, `myBookings.routes`, `patient-account*.spec` | ✅ | Needs live SMS ([F-11](FINDINGS.md#f-11)) |
| Records wallet, consent, reports | FR-PAT-63/64, FR-LAB-03 | `clinical.routes`, `consent.routes`, `wallet.spec`, `lab-report.spec` | ✅ | — |
| Patient documents upload | FR-PAT-62 | `patientDocuments.routes` | ✅ | Storage must be `local` ([F-04](FINDINGS.md#f-04)) |
| Bed request, emergency search, "on my way" | FR-PAT-52, GR-08 | `bed.routes`, `emergency.routes`, `emergency-burn.spec` | ✅ | Static travel times only |
| Medicine availability | FR-PHR-* | `lab.routes`, `labPharmacySafety.routes` | ✅ | — |
| Payments | FR-PAY-* | `payment*.test`, `paymentProviders.test` (stand-ins) | ⚠️ | Never run against bKash or Nagad; pilot runs `PAYMENT_PROVIDER=off` |
| Bangla/English, mobile layout | GR-06, FR-LOC-* | `language-switch.spec`, `bilingual.routes`, axe in specs | ✅ | Real handsets not tested |

## Hospital console

| Workflow | Requirement IDs | Evidence | Result | Remaining risk |
|---|---|---|---|---|
| Staff sign-in, lockout, refresh rotation, 2FA | FR-SEC-06, FR-SEC-10 | `staffAuth.routes`, `staffTwoFactor.routes`, `staff-login.spec`, `staff-2fa.spec` | ✅ | — |
| Deactivation / role change ends access now | FR-SEC-06 | `sessionRevocation.test`, `console-access.spec` | ✅ | — |
| Reception: next, done, late, no-show, pause, undo | FR-QUE-*, FR-REC-* | `queue.routes`, `queueConflict`, `reception-workspace.spec`, `console-undo.spec`, `pause-resume.spec` | ✅ | — |
| Two counters, one chamber | FR-QUE-53 | Audit scratch probe (console path) | ✅ | `/next` route unguarded ([F-03](FINDINGS.md#f-03)) |
| Offline actions, reload, reconnect | FR-OFF-01, FR-QUE-51 | `offline-console.spec`, `sync.routes`, built `console-offline-shell.spec` | ✅ | — |
| Replay keys bound to their chamber | FR-QUE-51 | Audit *F-02* | ❌→ fix | [F-02](FINDINGS.md#f-02) |
| Walk-in registration, identity receipt | FR-REC-14, FR-REC-20 | `registration.routes`, `receptionSafety.routes`, `registration-workspace.spec` | ✅ | Same-name people under one phone need confirmation (prior C9 note) |
| Doctor: draft, sign, next, unsaved notes | FR-DOC-08, FR-DOC-10, FR-QUE-53 | `doctorSafety.routes`, `doctor-safety.spec`, `doctor-workspace.spec` | ✅ | Hospital-wide access ([F-09](FINDINGS.md#f-09)); unsaved notes lost on a forced close |
| Ward and beds | FR-BED-* | `bed.routes`, `ward-board.spec` | ✅ | — |
| Emergency and referrals | FR-EMG-* | `emergency.routes`, `referral.routes`, `referral.spec` | ✅ | — |
| Laboratory orders and reports | FR-LAB-* | `lab.routes`, `labPharmacySafety.routes`, `lab-report.spec` | ✅ | Demo prices ([F-08](FINDINGS.md#f-08)) |
| Administration, reports, CSV | FR-ADM-* | `admin*.routes`, `admin-*.spec` | ✅ | — |
| Hospital settings, desks, modules | FR-ADM-11, FR-BRD-11 | `hospitalSettings.routes`, `hospitalDesks.routes`, `moduleRoutes.test` | ✅ | — |
| Data import and undo | FR-IMP-* | `import.routes`, `importMapping.routes`, `data-import.spec` | ✅ | — |

## Cross-cutting

| Control | Evidence | Result | Remaining risk |
|---|---|---|---|
| Hospital A cannot reach hospital B (every route) | `tenantMatrix.test` (194 routes), `tenantScope.test`, `apiRole.test` | ✅ | — |
| Realtime rooms respect hospital, role, desk, module | `realtime.test` | ✅ | — |
| No 5xx on malformed input, any route | Audit fuzz | ✅ | — |
| SQL only through parameters | Audit fuzz (SQL-shaped values), code review | ✅ | — |
| Security headers, CSP | `securityHeaders.test`, `security-headers.spec`, `csp.prod.spec` | ✅ | — |
| Dependencies | `pnpm audit` | ✅ | Point-in-time |
| Environment refuses unsafe production settings | `env.test` | ⚠️→ fix | [F-04](FINDINGS.md#f-04) |
| Self-hosted stack passes its settings | `docker compose config`, `deployment.test` | ❌→ fix | [F-05](FINDINGS.md#f-05) |
| Backup writes, verifies, restores | `deploy/backup.sh` drill (§6 of README) | *see README* | Not encrypted ([F-07](FINDINGS.md#f-07)); never run on the real server |
| Restart safety of timers | Code review (database-driven ticks) | ⚠️ | Not exercised by killing a live process |
| Real SMS, payments, Bangladesh server, CI | — | — | Not verifiable from here |
