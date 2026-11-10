// Builds the guidebook: content modules → one HTML file → A4 landscape PDF.
// node build.cjs [--html-only | --check-only]
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const L = require('./lib.cjs');

const DIR = __dirname;
const SHOTS = join(DIR, 'shots');
const OUT_HTML = join(DIR, 'book.html');
const OUT_PDF = join(DIR, 'MedLiveBD-Guidebook.pdf');
const LOGO = join(DIR, '../../frontend/patient/public/brand/medlivebd-logo-light.webp');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Shots and callouts ----------------------------------------------------------
const metaCache = new Map();
function meta(name) {
  if (!metaCache.has(name)) {
    const file = join(SHOTS, `${name}.json`);
    metaCache.set(name, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  }
  return metaCache.get(name);
}
const missing = [];

/** Finds the box a callout points at: by testid (nth), by testid prefix, by words, by tag, or given. */
function resolve(m, c) {
  if (c.box) return c.box;
  const els = m.elements;
  let found = [];
  if (c.id) found = els.filter((e) => e.id === c.id);
  else if (c.prefix) found = els.filter((e) => e.id && e.id.startsWith(c.prefix));
  else if (c.tag && !c.match) found = els;
  if (c.match) {
    const re = c.match instanceof RegExp ? c.match : new RegExp(c.match);
    found = (found.length ? found : els).filter((e) => re.test(e.text) || re.test(e.aria ?? ''));
  }
  if (c.tag) found = found.filter((e) => e.tag === c.tag);
  const visibleIn = found.filter((e) => e.box.x < m.width - 4 && e.box.y < m.height - 4 && e.box.x + e.box.w > 4 && e.box.y + e.box.h > 4);
  const pick = visibleIn[c.nth ?? 0];
  if (!pick) return null;
  const b = { ...pick.box };
  const x2 = Math.min(b.x + b.w, m.width - 2);
  const y2 = Math.min(b.y + b.h, m.height - 2);
  b.x = Math.max(b.x, 2);
  b.y = Math.max(b.y, 2);
  b.w = Math.max(x2 - b.x, 6);
  b.h = Math.max(y2 - b.y, 6);
  return b;
}

/** Targets of a shot in drawn pixels, numbered; misses are recorded. */
function targetsFor(m, shotName, callouts, scale) {
  const out = [];
  for (const c of callouts) {
    const box = resolve(m, c);
    if (!box) {
      missing.push(`${shotName}: ${c.id ?? c.prefix ?? c.match ?? c.tag}`);
      continue;
    }
    out.push({ n: c.n, side: c.side, box: { x: box.x * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale } });
  }
  return out;
}

const R = 11; // badge radius
const G = 32; // gutter width each side of a picture

/**
 * Badges in the gutters beside the picture, never on it: each sits level with
 * its target where it can, stacked without overlap, with an arrow to the
 * target's near edge. Coordinates: the picture starts at x = G.
 */
function gutterLayout(targets, W, H) {
  const yOf = (t) => t.box.y + Math.min(t.box.h, 36) / 2;
  const sideOf = (t) => t.side ?? (t.box.x + t.box.w / 2 < W / 2 ? 'left' : 'right');
  const place = (list, bx) => {
    list.sort((a, b) => yOf(a) - yOf(b));
    const gap = 2 * R + 5;
    let prev = -Infinity;
    const out = list.map((t) => {
      const y = Math.max(yOf(t), prev + gap, R + 2);
      prev = y;
      return { ...t, bx, by: y };
    });
    let maxY = H - R - 2;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].by > maxY) out[i].by = maxY;
      maxY = out[i].by - gap;
    }
    return out;
  };
  const left = targets.filter((t) => sideOf(t) === 'left');
  const right = targets.filter((t) => sideOf(t) !== 'left');
  return [...place(left, G / 2), ...place(right, G + W + G / 2)].map((p) => {
    const onLeft = p.bx < G;
    const ax = onLeft ? G + p.box.x - 3 : G + p.box.x + p.box.w + 3;
    const ay = Math.min(Math.max(p.by, p.box.y + 5), p.box.y + p.box.h - 5);
    return { ...p, onLeft, ax, ay };
  });
}

function overlay(placed, W, H) {
  const parts = [];
  for (const p of placed) {
    const b = p.box;
    parts.push(`<rect x="${G + b.x - 3}" y="${b.y - 3}" width="${b.w + 6}" height="${b.h + 6}" rx="6" class="hl"/>`);
  }
  for (const p of placed) {
    const sx = p.onLeft ? p.bx + R : p.bx - R;
    parts.push(`<line x1="${sx}" y1="${p.by}" x2="${p.ax}" y2="${p.ay}" class="ar" marker-end="url(#head)"/>`);
    parts.push(`<circle cx="${p.bx}" cy="${p.by}" r="${R}" class="bd"/><text x="${p.bx}" y="${p.by + 4.5}" class="bt">${p.n}</text>`);
  }
  const fullW = W + 2 * G;
  return `<svg class="ov" viewBox="0 0 ${fullW} ${H}" width="${fullW}" height="${H}"><defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>${parts.join('')}</svg>`;
}

/** One picture (or one strip of a tall one) with its gutters and markers. */
function picture(src, W, fullH, top, h, targets, phone) {
  const mine = targets.filter((t) => {
    const cy = t.box.y + Math.min(t.box.h, 36) / 2;
    return cy >= top && cy < top + h;
  });
  const shifted = mine.map((t) => ({ ...t, box: { ...t.box, y: t.box.y - top } }));
  const placed = gutterLayout(shifted, W, h);
  return `<div class="shotwrap" style="width:${W + 2 * G}px;height:${h}px"><div class="shot${phone ? ' phone' : ''}" style="left:${G}px;width:${W}px;height:${h}px"><img src="${src}" style="width:${W}px;height:${fullH}px;top:${-top}px"/></div>${overlay(placed, W, h)}</div>`;
}

const legendOf = (callouts) =>
  callouts.map((c) => `<li><span class="num">${c.n}</span><div><b>${esc(c.label)}</b>${c.text ? ` ${c.text}` : ''}</div></li>`).join('');

/** One figure: the picture (in strips if it is a tall phone page), markers and the legend. */
function figure(page) {
  const m = meta(page.shot);
  if (!m) {
    missing.push(page.shot);
    return `<section class="page"><h2>${esc(page.title)}</h2><p class="missing">Screenshot ${esc(page.shot)} was not captured.</p></section>`;
  }
  const phone = m.width < 600;
  const callouts = (page.callouts ?? []).map((c, i) => ({ ...c, n: i + 1 }));
  // A desktop screen with few points gets the whole width, its legend below.
  const wide = !phone && (page.wide ?? callouts.length <= 6);
  let scale;
  let stripH;
  let strips = 1;
  if (phone) {
    const maxH = 560;
    // At most two strips, so the legend always has its column.
    scale = Math.min(250 / m.width, (2 * maxH) / m.height);
    const fullH = m.height * scale;
    strips = Math.max(1, Math.ceil(fullH / maxH - 0.02));
    stripH = Math.ceil(fullH / strips);
  } else {
    const maxW = wide ? 940 : 660;
    const maxH = wide ? 505 : 470;
    scale = Math.min(maxW / m.width, maxH / m.height);
  }
  const W = Math.round(m.width * scale);
  const fullH = Math.round(m.height * scale);
  if (!phone) stripH = fullH;
  const targets = targetsFor(m, page.shot, callouts, scale);
  const src = pathToFileURL(join(SHOTS, `${page.shot}.jpg`)).href;
  let pictures = '';
  for (let s = 0; s < strips; s++) {
    const top = s * stripH;
    const h = Math.min(stripH, fullH - top);
    pictures += picture(src, W, fullH, top, h, targets, phone);
  }
  const legend = legendOf(callouts);
  const cls = `page fig${phone ? ' fig-phone' : ''}${wide ? ' fig-wide' : ''}`;
  return `<section class="${cls}">
  <div class="fig-head"><div class="crumb">${esc(page.crumb ?? '')}</div><h2>${esc(page.title)}</h2>${page.intro ? `<p class="intro">${page.intro}</p>` : ''}</div>
  <div class="fig-body"><div class="pics">${pictures}</div><div class="legend">${legend ? `<ol>${legend}</ol>` : ''}${page.note ? `<div class="note">${page.note}</div>` : ''}</div></div>
</section>`;
}

/** Two pictures side by side (before / after, Bangla / English). */
function pair(page) {
  const cells = page.shots
    .map((s) => {
      const m = meta(s.shot);
      if (!m) {
        missing.push(s.shot);
        return `<div class="pair-cell"><p class="missing">${esc(s.shot)} missing</p></div>`;
      }
      const phone = m.width < 600;
      const maxW = phone ? 240 : 450;
      const maxH = phone ? 490 : 300;
      const scale = Math.min(maxW / m.width, maxH / m.height);
      const W = Math.round(m.width * scale);
      const H = Math.round(m.height * scale);
      const src = pathToFileURL(join(SHOTS, `${s.shot}.jpg`)).href;
      const callouts = (s.callouts ?? []).map((c, i) => ({ ...c, n: c.n ?? i + 1 }));
      const targets = targetsFor(m, s.shot, callouts, scale);
      return `<div class="pair-cell"><div class="cap">${esc(s.caption ?? '')}</div>${picture(src, W, H, 0, H, targets, phone)}</div>`;
    })
    .join('');
  const legend = (page.legend ?? []).map((c, i) => ({ ...c, n: c.n ?? i + 1 }));
  return `<section class="page fig pairpage">
  <div class="fig-head"><div class="crumb">${esc(page.crumb ?? '')}</div><h2>${esc(page.title)}</h2>${page.intro ? `<p class="intro">${page.intro}</p>` : ''}</div>
  <div class="pair">${cells}</div>${legend.length ? `<ol class="pair-legend">${legendOf(legend)}</ol>` : ''}${page.note ? `<div class="note">${page.note}</div>` : ''}
</section>`;
}

// --- Pages ---------------------------------------------------------------------------
function render(pages) {
  const toc = [];
  let html = '';
  pages.forEach((p, i) => {
    const anchor = `p${i}`;
    if (p.type === 'part' || p.type === 'chapter') toc.push({ type: p.type, title: p.title, num: p.num, anchor });
    switch (p.type) {
      case 'cover':
        html += `<section class="page cover"><div class="cover-in"><img class="logo" src="${pathToFileURL(LOGO).href}"/><h1>${p.title}</h1><p class="sub">${p.subtitle}</p><div class="cover-parts">${p.parts}</div><p class="edition">${p.edition}</p></div></section>`;
        break;
      case 'toc':
        html += '<section class="page tocpage"><h2>Contents</h2><div class="toc">%%TOC%%</div></section>';
        break;
      case 'part':
        html += `<section class="page part" id="${anchor}"><div class="part-in"><div class="part-letter">Part ${esc(p.letter)}</div><h1>${esc(p.title)}</h1><p>${p.lead}</p>${p.html ?? ''}</div></section>`;
        break;
      case 'chapter':
        html += `<section class="page chapter" id="${anchor}"><div class="ch-num">${esc(p.num)}</div><h1>${esc(p.title)}</h1><p class="lead">${p.lead}</p>${p.html ? `<div class="ch-body">${p.html}</div>` : ''}</section>`;
        break;
      case 'text':
        html += `<section class="page text${p.cols === 1 ? ' one' : ''}">${p.crumb ? `<div class="crumb">${esc(p.crumb)}</div>` : ''}<h2>${esc(p.title)}</h2><div class="body">${p.html}</div></section>`;
        break;
      case 'figure':
        html += figure(p);
        break;
      case 'pair':
        html += pair(p);
        break;
      default:
        throw new Error(`unknown page type ${p.type}`);
    }
  });
  const tocHtml = toc
    .map((t) => (t.type === 'part' ? `<div class="toc-part"><a href="#${t.anchor}">${esc(t.title)}</a></div>` : `<div class="toc-ch"><a href="#${t.anchor}"><span>${esc(t.num)}</span>${esc(t.title)}</a></div>`))
    .join('');
  return html.replace('%%TOC%%', tocHtml);
}

(async () => {
  const CSS = readFileSync(join(DIR, 'book.css'), 'utf8');
  for (const m of ['./content-a.cjs', './content-b.cjs']) delete require.cache[require.resolve(m)];
  const pages = [...require('./content-a.cjs'), ...require('./content-b.cjs')];
  const body = render(pages);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MedLiveBD — Guidebook</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Anek+Bangla:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`;
  writeFileSync(OUT_HTML, html);
  console.log(`pages defined: ${pages.length}`);
  if (missing.length) console.log(`MISSING (${missing.length}):\n  ${missing.join('\n  ')}`);
  if (process.argv.includes('--html-only')) return;
  const browser = await L.chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(OUT_HTML).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  // Nothing may run off a page: a text body that overflows its columns grows
  // sideways, any other page grows downwards.
  const overflow = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('section.page').forEach((sec, i) => {
      const title = (sec.querySelector('h1, h2')?.textContent ?? '').trim().slice(0, 60);
      for (const el of sec.querySelectorAll('.body, .ch-body')) {
        if (el.scrollWidth > el.clientWidth + 2) bad.push(`page ${i + 1} "${title}": columns overflow by ${el.scrollWidth - el.clientWidth}px`);
      }
      if (sec.scrollHeight > sec.clientHeight + 2) bad.push(`page ${i + 1} "${title}": ${sec.scrollHeight - sec.clientHeight}px too tall`);
      if (sec.scrollWidth > sec.clientWidth + 2) bad.push(`page ${i + 1} "${title}": ${sec.scrollWidth - sec.clientWidth}px too wide`);
    });
    return bad;
  });
  if (overflow.length) console.log(`OVERFLOW (${overflow.length}):\n  ${overflow.join('\n  ')}`);
  else console.log('no page overflows');
  if (process.argv.includes('--check-only')) {
    await browser.close();
    return;
  }
  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#6b7a90;padding:0 14mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>MedLiveBD Guidebook · demonstration data only</span><span class="pageNumber"></span></div>',
    margin: { top: '0', bottom: '9mm', left: '0', right: '0' },
  });
  await browser.close();
  const bytes = readFileSync(OUT_PDF);
  const count = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(`PDF written: ${OUT_PDF} (${(bytes.length / 1048576).toFixed(1)} MB, ${count} pages)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
