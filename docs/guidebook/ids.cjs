// Prints the labelled elements of saved shots: node ids.cjs <name-prefix> [--all]
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = join(__dirname, 'shots');
const prefix = process.argv[2] ?? '';
const all = process.argv.includes('--all');
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n.startsWith(prefix)).sort()) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  console.log(`\n## ${j.name} ${j.width}x${j.height} ${j.url.replace(/https?:\/\/localhost:\d+/, '')}`);
  for (const e of j.elements) {
    if (!all && !e.id) continue;
    const b = e.box;
    console.log(`  ${(e.id ?? e.tag).padEnd(34)} ${String(b.x).padStart(4)},${String(b.y).padStart(4)} ${String(b.w).padStart(4)}x${String(b.h).padEnd(4)} ${e.text.slice(0, 60)}`);
  }
}
