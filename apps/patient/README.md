# apps/patient — Patient PWA (Part A)

Next.js App Router, Bangla by default, installable, offline-tolerant.
Screens and wiring: `docs/APP_FLOW.md` Part A (`S-A-00` … `S-A-20`).
Look and client patterns: `docs/FRONTEND.md`.

The Next.js application is scaffolded in **step 9 (`feat/patient-booking`)**, on
top of the design system from step 7. It is intentionally not scaffolded earlier:
the first screen written must already have tokens, `t()` and the four required
states (loading, empty, error, offline) available to it, or the design
fragments and hard-coded strings creep in.

The screen this app exists for is `S-A-08` Live Serial (step 10), which must
reflect a reception action within two seconds.
