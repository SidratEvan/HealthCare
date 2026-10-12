# Company site — final premium redesign (12 October 2026)

Branch `feat/site-final-premium-redesign`. Static export for Cloudflare Pages
(`SITE_EXPORT=1 next build`), previewed locally with
`node frontend/site/scripts/preview-static.mjs` (port 3210). Screenshots in this
folder come from `frontend/site/scripts/capture-site.mjs` against that preview.

## Direction

A dark, photographic healthcare-technology campaign. Midnight navy is the
atmosphere, deep blue lifts a surface, and the logo's blue and teal carry action
and meaning. There are no white sections. Geist sets English and Anek Bangla
sets Bangla; Bangla display text is at 1.35 line-height and reading text at 1.65
or more, never letter-spaced (`TYP-01`).

The homepage has seven scenes:

1. **Hero:** Codex's doctors photograph, the owner's headline, and two large
   audience doors on the first screen at every size.
2. **The idea:** the statement lights word by word with scroll; a signal leaves
   *Hospitals*, passes the MedLiveBD mark and reaches *Patients*. It tells the
   live queue without a screenshot.
3. **For Hospitals:** the case, then the team photograph as a full-width band
   (all three doctors in frame), then four capabilities.
4. **For Patients:** an editorial spread with three journey steps and
   **Open Patient App** (Demo).
5. **Built for Bangladesh:** the signature camera moment. On large screens the
   scene holds (sticky, never hijacked) while the view pulls back from Dhaka,
   the outline traces and lines reach the eight division headquarters. It is
   labelled a vision, not coverage.
6. **The people behind MedLiveBD:** names, roles and focus as type; no invented
   faces.
7. **Closing:** Dhaka at blue hour, **Request a Demo**, support@medlivebd.com.

## Destinations (real links; none scrolls the page)

| Control | Goes to |
|---|---|
| For Hospitals / Explore Hospital Solutions | `/{bn,en}/hospitals` |
| For Patients / Open Patient App | `https://healthcare-patient-zeta.vercel.app` (new tab, tagged Demo) |
| Request a Demo | `mailto:support@medlivebd.com` (subject and a short template prefilled) |
| About Us | `/{bn,en}/about` (`/founders` redirects there) |

## Motion

Framer Motion only. Scroll-linked values map straight to transform, opacity or
SVG path length: no springs and no React state per frame. One pinned scene (the
map, desktop only). Everything reverses with the scroll. With reduced motion, or
without script, every scene is complete and still.

## Photographs

`public/campaign/*` is unchanged from Codex's work, and the originals are in
`docs/design/site-cinematic/originals/`. On the homepage each photograph
appears once: hero → hero, team → hospitals, patient → patients, atmosphere →
closing. The hospitals page reuses the team photograph.
