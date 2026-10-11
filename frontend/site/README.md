# frontend/site — MedLiveBD company presentation

The accelerated completion brief authorizes a separate bilingual public company
presentation with the existing logo and confirmed `sidrat@medlivebd.com` contact.
The default entrance redirects to `/bn`; `/en` has its own server-rendered
document language and metadata. No patient, hospital-login, inquiry backend or
clinical API is connected to this site. Demonstration requests open email.

Run `pnpm --filter @platform/site dev` for local development on port 3200.
For a built preview, run `pnpm --filter @platform/site build`, then
`pnpm --filter @platform/site start`. Run `pnpm --filter @platform/site test:smoke`
against the built preview; the configuration can start it if needed.

This delivers the company-presentation brief, not all historical Part C routes
in APP_FLOW.md. Patient/console entrances, lead pipeline, brochure and separate
policy pages remain outside this brief. There is no deployment configuration
change, Site registration, publication or provider activation.

Verification and representative captures: `docs/design/company-site/README.md`.
