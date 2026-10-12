import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Local verification of the actual Cloudflare export, never a deployment.
const root = path.resolve(fileURLToPath(new URL('../out/', import.meta.url)));
const port = Number(process.env.SITE_PREVIEW_PORT ?? 3210);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};
http
  .createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    try {
      const pathname = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
      if (pathname === '/') {
        res.writeHead(302, { Location: '/bn' });
        res.end();
        return;
      }
      let file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep) && file !== root) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!path.extname(file)) file += '.html';
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': data.length,
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(path.join(root, '404.html')).catch(() => 'Not found'));
    }
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Local static preview: http://localhost:${port}`);
  });
