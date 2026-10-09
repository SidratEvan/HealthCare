# One doctor, several workplaces — design note (plan R5)

**Status: proposed, waiting for the owner's approval.** No code is written
until it is approved (`docs/PLATFORM_PLAN.md`, decision 6; `CLAUDE.md` §4.6).
This note has no authority over behaviour; when approved, its decisions go
into `PRD.md`, `APP_FLOW.md`, `DATABASE.md` and `BACKEND.md` first, as always.

## What the owner decided (8 October, decision 6)

One doctor login for several authorised organisations; each organisation is
its own dashboard; they are never mixed; and one organisation gets no
automatic access to another's records.

## Where the product stands

- A staff account belongs to one hospital: `staff_users.hospital_id`, and
  every tenant policy (migration 0043) asks `app_hospital()`, which comes from
  the token's one `hospitalId`.
- An email is unique **per hospital** (`staff_users_hospital_email_key`), so a
  doctor can already hold an account at each of two hospitals. Sign-in takes
  an optional hospital code to say which (`POST /staff/login`
  `hospitalCode`). Each account has its own password and its own second
  factor. That works, and it is clumsy: two passwords, two codes, and nothing
  that knows the two accounts are one person.

## The proposal: link the accounts, never widen a token

**A token keeps exactly one hospital.** Nothing in the 0043, 0044 and 0056
policies changes, and no read can mix two hospitals' rows, because no request
is ever in two hospitals at once. What changes is how a person reaches a
token.

1. **A person.** A new `staff_people` row holds what belongs to the person
   and not to a workplace: the sign-in email, the password, the second
   factor, the lockout counters. Each `staff_users` row (one per workplace,
   with that workplace's roles, staff code and audit trail) gains
   `person_id`. A person with one workplace is today's account, unchanged in
   use.
2. **Sign-in, then a workplace.** `POST /staff/login` checks the person's
   password and second factor once. One workplace: the token is minted as
   today. Several: the answer is the list of workplaces (each hospital's name
   and logo, `FR-BRD-12`) and a short-lived, single-use choice ticket;
   `POST /staff/workplace` with the ticket and a hospital mints that
   hospital's token. The hospital code field goes.
3. **Switching.** The console's rail offers the person's other workplaces.
   Switching revokes the current refresh token and mints the other
   hospital's, through the same ticket path: a full change of hospital,
   never two at once. Each workplace opens on its own dashboard and in its
   own colours.
4. **Joining another workplace needs the person's consent.** When an
   administrator adds staff with an email that already belongs to a person,
   the new workplace is **pending** until that person signs in and accepts it.
   Without this, hospital B could attach itself to a doctor's sign-in. Until
   accepted, the doctor's existing sign-in shows nothing of hospital B and
   hospital B's account cannot be used.
5. **No automatic access to records.** Unchanged and stated: a doctor at
   hospital A reads what hospital A may read; that the same person works at
   hospital B opens nothing of B's in A, and nothing of A's in B. A record
   crosses only under the patient's consent (`FR-NET-02`, `FR-SEC-04`).
6. **Audit stays per workplace.** Every audited act names the `staff_users`
   row, so each hospital's trail shows only what was done in it. Sign-ins and
   workplace switches are recorded against the person.
7. **Leaving.** A hospital deactivating its row ends that workplace and
   nothing else. A person with no active workplace cannot sign in.

## What it would touch

- A migration: `staff_people`; `staff_users.person_id`; credentials move from
  `staff_users` to `staff_people` (one person per existing account, a
  mechanical copy); a pending state on a workplace.
- `staffAuth`: login, the workplace ticket, switch, accept; `pnpm
  staff:create`; password change and 2FA on the person.
- The console: the workplace list after sign-in, the switcher in the rail, the
  pending-invitation prompt.
- Tests: the tenant matrix unchanged in kind, plus the switch and the consent
  to join; the auth suites; the two browser specs for sign-in and 2FA.

Roughly the size of pilot step 21 (staff sign-in) again. It does not touch the
queue, the patient app or any tenant policy.

## What it does not do

- No token, screen or report ever spans two hospitals.
- No doctor-level record sharing between a doctor's own workplaces.
- Patients are unaffected.

## For the owner to decide

1. **Approve this shape** (link accounts into one person; one hospital per
   token; switching mints a new token), or ask for another.
2. **Consent to join:** a new workplace is pending until the doctor accepts
   it (recommended), or an administrator's adding is enough.
3. **Timing:** it changes sign-in, which the first pilot depends on. The
   recommendation is to build it after the first pilot has signed in for real,
   on its own branch, so the pilot's sign-in is never the thing being changed.
