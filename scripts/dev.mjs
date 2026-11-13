// Serves public/ the way GitHub Pages does: a file if it exists, otherwise the app (Pages uses 404.html,
// a copy of index.html made by the workflow). No dependencies: node scripts/dev.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const port = Number(process.env.PORT || process.argv[2] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    const file = join(root, /^[\\/]$/.test(path) ? 'index.html' : path);
    try {
        if (!file.startsWith(root)) throw new Error('outside root');
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(body);
    } catch {
        response.writeHead(extname(path) ? 404 : 200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
        response.end(extname(path) ? 'Not found' : await readFile(join(root, 'index.html')));
    }
}).listen(port, () => console.log(`xyzt on http://localhost:${port}`));
