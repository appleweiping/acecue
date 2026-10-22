// acecue and ai-mirror share their provider code. This compares the local
// copies of the shared files with the ones on the other repo's GitHub branch.
//
//   node scripts/check-shared.mjs ai-mirror main     (run from acecue)
//   node scripts/check-shared.mjs acecue master      (run from ai-mirror)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const SHARED_FILES = [
  "api/_providers.js",
  "api/chat.js",
  "api/models.js",
  "public/js/stream-client.js",
  "scripts/dev-server.mjs",
  "scripts/check-shared.mjs",
  "test/providers.test.js",
];

const [repo, branch = "main"] = process.argv.slice(2);
if (!repo) {
  console.error("usage: node scripts/check-shared.mjs <other-repo> [branch]");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const norm = (s) => s.replace(/\r\n/g, "\n");
let different = 0;

for (const file of SHARED_FILES) {
  const local = norm(await readFile(join(root, file), "utf8"));
  const url = `https://raw.githubusercontent.com/appleweiping/${repo}/${branch}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`??   ${file}  (HTTP ${res.status} from ${url})`);
    different += 1;
    continue;
  }
  const remote = norm(await res.text());
  const same = local === remote;
  if (!same) different += 1;
  console.log(`${same ? "ok  " : "DIFF"} ${file}`);
}

console.log(different ? `\n${different} file(s) differ from ${repo}@${branch}.` : `\nAll shared files match ${repo}@${branch}.`);
process.exit(different ? 1 : 0);
