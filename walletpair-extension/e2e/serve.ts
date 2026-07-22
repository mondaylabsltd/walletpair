import { createServer } from 'http';
import { readFileSync } from 'fs';
import { resolve, extname } from 'path';

const PORT = Number(process.env.E2E_PORT) || 3456;
const ROOT = resolve(import.meta.dirname!, '.');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const server = createServer((req, res) => {
  const filePath = resolve(ROOT, (req.url === '/' ? '/dapp-e2e.html' : req.url!).slice(1));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`E2E server: http://localhost:${PORT}`));
export { server, PORT };
