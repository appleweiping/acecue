// Local dev server with no dependencies: serves public/ and runs the edge
// handlers in api/ under Node (Node 20+ has fetch, Request and Response).
// `vercel dev` also works; this just avoids needing the Vercel CLI.
// Same file in appleweiping/acecue and appleweiping/ai-mirror.
//
//   node scripts/dev-server.mjs                   -> http://localhost:3000
//   PORT=8080 node scripts/dev-server.mjs
//   MOCK_UPSTREAM=1 node scripts/dev-server.mjs   -> canned replies, no real API calls

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const port = Number(process.env.PORT) || 3000;

// Apply the catch-all headers from vercel.json (CSP etc.) so local runs
// behave like the deployed site.
let siteHeaders = {};
try {
  const cfg = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
  const all = (cfg.headers || []).find((h) => h.source === "/(.*)");
  for (const { key, value } of all?.headers || []) siteHeaders[key.toLowerCase()] = value;
} catch { siteHeaders = {}; }

// MOCK_UPSTREAM=1 replaces calls to the real providers with canned replies
// from scripts/mock-upstream.mjs, for trying the UI without a key. Any
// non-empty key works in this mode. The replies are not model output.
if (process.env.MOCK_UPSTREAM === "1") {
  const { installMock } = await import(pathToFileURL(join(root, "scripts", "mock-upstream.mjs")).href);
  installMock();
  console.log("MOCK_UPSTREAM=1: provider calls get canned replies (scripts/mock-upstream.mjs)");
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

async function handleApi(req, res, url) {
  const name = url.pathname.slice("/api/".length);
  if (!/^[a-z0-9-]+$/i.test(name)) return send(res, 404, "not found");
  const file = join(root, "api", `${name}.js`);
  if (!existsSync(file)) return send(res, 404, "not found");
  const mod = await import(pathToFileURL(file).href);

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const abort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) abort.abort(); });
  const request = new Request(url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    signal: abort.signal,
  });

  const response = await mod.default(request);
  res.writeHead(response.status, { ...siteHeaders, ...Object.fromEntries(response.headers) });
  if (response.body) {
    try {
      for await (const chunk of response.body) res.write(chunk);
    } catch { /* client went away */ }
  }
  res.end();
}

async function handleStatic(res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  let file = resolve(join(publicDir, path));
  if (!file.startsWith(publicDir + sep) && file !== publicDir) return send(res, 403, "forbidden");
  if (!extname(file) && existsSync(file + ".html")) file += ".html";
  try {
    const data = await readFile(file);
    res.writeHead(200, { ...siteHeaders, "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    send(res, 404, "not found");
  }
}

function send(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await handleStatic(res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, "server error");
    else res.end();
  }
});

server.listen(port, () => console.log(`dev server on http://localhost:${port}`));
