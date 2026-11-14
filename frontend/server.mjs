import http from 'node:http';
import { readFile } from 'node:fs/promises';

const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/model.mjs': ['model.mjs', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const port = Number(process.env.PATIENT_PORT || 5173);
http.createServer(async (request, response) => {
  const entry = files[new URL(request.url, 'http://localhost').pathname];
  if (!entry) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await readFile(new URL(entry[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8` });
    response.end(body);
  } catch { response.writeHead(500); response.end('Unable to load page'); }
}).listen(port, '127.0.0.1', () => console.log(`MediQueue: http://localhost:${port}`));
