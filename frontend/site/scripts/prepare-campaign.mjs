import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require(
  require.resolve('sharp', { paths: [path.dirname(require.resolve('next/package.json'))] }),
);
const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error('Provide the generated image directory.');
const root = new URL('../public/campaign/', import.meta.url);
const originals = new URL('../../../docs/design/site-cinematic/originals/', import.meta.url);
await mkdir(root, { recursive: true });
await mkdir(originals, { recursive: true });
const files = {
  hero: 'exec-a5fa9344-5dcd-4edf-addf-97cfa99ece1f.png',
  team: 'exec-0630cbc9-31f1-447e-80e5-3bf76f11d36f.png',
  patient: 'exec-af0e2863-fb12-4483-9f1e-6fca055df190.png',
  atmosphere: 'exec-a5abf992-698a-4420-8ab6-8decc639f5f6.png',
};
const manifest = [];
for (const [name, file] of Object.entries(files)) {
  const input = path.join(sourceRoot, file);
  await copyFile(input, new URL(`${name}.png`, originals));
  const metadata = await sharp(input).metadata();
  for (const width of [640, 1200, 1920]) {
    const height = Math.round(
      width * (name === 'hero' || name === 'atmosphere' ? 828 / 1920 : 2 / 3),
    );
    for (const format of ['avif', 'webp']) {
      const target = new URL(`${name}-${width}.${format}`, root);
      const info = await sharp(input)
        .resize(width, height, { fit: 'cover' })
        .toFormat(format, { quality: format === 'avif' ? 53 : 80 })
        .toFile(target.pathname.replace(/^\/([A-Z]:)/i, '$1'));
      manifest.push({ name, width, height, format, bytes: info.size });
    }
  }
  console.log(`${name}: ${metadata.width} x ${metadata.height}`);
}
await writeFile(
  new URL('../../../docs/design/site-cinematic/asset-sizes.json', import.meta.url),
  JSON.stringify(manifest, null, 2),
);
