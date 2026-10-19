// Converts a package's TypeScript sources to JavaScript, once
// (docs/django-migration/frontend-js.md).
//
//   node scripts/ts-to-js.mjs <dir> [<dir> ...]
//
// The TypeScript compiler removes the types and nothing else: JSX is kept as
// written (`jsx: preserve`), the target is ESNext so no syntax is lowered, and
// comments stay. The compiler drops blank lines, so each blank line outside a
// template literal or JSX text is held by a marker comment through the
// compile and restored after. A relative `./x.js` import of what was `x.tsx`
// becomes `./x.jsx`. Prettier formats the result with the repository's rules.
//
// A file left with nothing but `export {}` held only types and is removed.

import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import * as prettier from 'prettier';
import ts from 'typescript';

const MARK = '/*__blank_line__*/';
const roots = process.argv.slice(2).map((dir) => resolve(dir));

function sources(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') continue;
    if (statSync(full).isDirectory()) found.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

/** Character ranges a marker may not be put inside. */
function protectedRanges(file, text) {
  const tree = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const ranges = [];
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateExpression:
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.JsxText:
        ranges.push([node.getStart(tree), node.getEnd()]);
        return;
      default:
        ts.forEachChild(node, visit);
    }
  };
  visit(tree);
  // Inside a JSX element's children a comment would be text: every blank
  // line between the opening and closing tag is left to Prettier.
  const jsx = (node) => {
    if (node.kind === ts.SyntaxKind.JsxElement || node.kind === ts.SyntaxKind.JsxFragment) {
      ranges.push([node.getStart(tree), node.getEnd()]);
      return;
    }
    ts.forEachChild(node, jsx);
  };
  jsx(tree);
  return ranges;
}

function markBlankLines(file, text) {
  const ranges = protectedRanges(file, text);
  const inside = (at) => ranges.some(([from, to]) => at > from && at < to);
  let out = '';
  let at = 0;
  for (const line of text.split('\n')) {
    out += line.trim() === '' && !inside(at) ? MARK : line;
    out += '\n';
    at += line.length + 1;
  }
  return out.slice(0, -1);
}

const converted = new Map(); // original path -> new path
for (const root of roots)
  for (const file of sources(root))
    converted.set(file, file.replace(/\.tsx$/, '.jsx').replace(/\.ts$/, '.js'));

const prettierConfig = (await prettier.resolveConfig(join(process.cwd(), 'package.json'))) ?? {};
const removed = [];
for (const [from, to] of converted) {
  const text = readFileSync(from, 'utf8').replace(/\r\n/g, '\n');
  const { outputText } = ts.transpileModule(markBlankLines(from, text), {
    fileName: from,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      useDefineForClassFields: true,
      removeComments: false,
      verbatimModuleSyntax: false,
    },
  });
  let js = outputText
    .split('\n')
    .map((line) => (line.trim() === MARK ? '' : line.replaceAll(MARK, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '');
  // `./x.js` that was `x.tsx` is now `x.jsx`.
  js = js.replace(
    /(from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\.js\2/g,
    (whole, lead, quote, spec) => {
      const target = resolve(dirname(from), `${spec}.tsx`);
      return converted.has(target) ? `${lead}${quote}${spec}.jsx${quote}` : whole;
    },
  );
  if (/^(\s*export\s*\{\s*\};?\s*)?$/.test(js.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) {
    rmSync(from);
    removed.push(relative(process.cwd(), from));
    continue;
  }
  const formatted = await prettier.format(js, { ...prettierConfig, filepath: to });
  writeFileSync(to, formatted);
  rmSync(from);
}

console.log(
  `converted ${converted.size - removed.length}, removed ${removed.length} type-only file(s)`,
);
for (const file of removed) console.log(`  removed ${file}`);
