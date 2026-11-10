# The MedLiveBD guidebook

`MedLiveBD-Guidebook.pdf` is built from this folder: real screenshots of every
screen, taken from the apps running on demonstration data, with numbered
markers and arrows placed from each element's position, and the text of both
parts (A for everyone, B for engineers).

Nothing here is part of the product. The PDF, the screenshots and the HTML are
build output and are not committed (`.gitignore`).

## Regenerating it

1. Local database and demo data (Docker Desktop running):

   ```bash
   docker start healthcare-db
   DATABASE_URL=postgresql://healthcare:healthcare@localhost:5432/healthcare_dev DEMO_MODE=true pnpm db:migrate
   ```

2. The apps, built and started in demonstration mode (three terminals):

   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1 NEXT_PUBLIC_SOCKET_URL=http://localhost:4000 \
     NEXT_PUBLIC_PLATFORM_DOMAIN=localhost pnpm --filter @platform/console build
   NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1 NEXT_PUBLIC_SOCKET_URL=http://localhost:4000 \
     NEXT_PUBLIC_PLATFORM_DOMAIN=localhost pnpm --filter @platform/patient build

   DATABASE_URL=postgresql://healthcare:healthcare@localhost:5432/healthcare_dev DEMO_MODE=true \
     DEMO_PHONES=any NODE_ENV=development PLATFORM_DOMAIN=localhost ADDRESS_RATE_LIMIT_FACTOR=100 pnpm dev:api
   (cd frontend/console && pnpm exec next start --port 3100)
   (cd frontend/patient && pnpm exec next start --port 3000)
   ```

3. Every screenshot, on fresh demo data (about 15 minutes; it resets
   `healthcare_dev`):

   ```bash
   bash docs/guidebook/run-all.sh
   ```

   `run-all.log` lists each shot and any step that failed.

4. The book:

   ```bash
   node docs/guidebook/build.cjs
   ```

   It prints the page count, any marker whose element was not found
   (`MISSING`), and writes `MedLiveBD-Guidebook.pdf` here.

## How it is put together

| File | What it does |
|---|---|
| `lib.cjs` | the browser, demo sessions, and `shot()`: a JPEG plus every labelled element's box (and `marks`: text found by its words) |
| `cap-patient.cjs`, `cap-console-a.cjs`, `cap-console-b.cjs`, `cap-fix.cjs`, `cap-platform-new.cjs` | the captures, screen by screen, each step allowed to fail without stopping the rest |
| `content-a-*.cjs`, `content-b.cjs` | the pages: chapters, text, and figures with their markers (`id`, `prefix`, `match`, `tag`) |
| `ids.cjs`, `preview.cjs` | list a shot's labelled elements; render chosen pages to PNG for a look |
| `build.cjs`, `book.css` | layout (markers placed beside their targets with an arrow; tall phone pages split into strips) and the PDF (A4 landscape, Chromium) |

A marker names an element by its `data-testid`, so when a screen changes the
book follows it; a marker that no longer finds its element is listed, never
silently drawn in the wrong place.
