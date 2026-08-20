/* Push the recordings into R2.
 *
 * They still live in public/audio for the open GitHub Pages build, so
 * this reads from there. Once that build is retired, move the folder to
 * media/ (gitignored) and this picks it up from either place.
 *
 *   node scripts/upload-media.mjs           # the real bucket
 *   node scripts/upload-media.mjs --local   # wrangler dev's local one
 *
 * Re-running is safe: every object is simply overwritten.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { r2Key } from "../shared/catalog.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const BUCKET = "kriya-audio";
const WRANGLER = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const source = [join(root, "media"), join(root, "public", "audio")].find(existsSync);
if (!source) {
  console.error("No recordings found — looked in media/ and public/audio/.");
  process.exit(1);
}

const local = process.argv.includes("--local");
const files = readdirSync(source).filter((f) => f.toLowerCase().endsWith(".mp3"));
if (!files.length) {
  console.error(`No .mp3 files in ${source}`);
  process.exit(1);
}

const size = (p) => `${(statSync(p).size / 1024 / 1024).toFixed(1)}MB`;
console.log(`Uploading ${files.length} recordings from ${source} to ${BUCKET}${local ? " (local)" : ""}\n`);

let done = 0;
for (const file of files) {
  const path = join(source, file);
  process.stdout.write(`  ${file} (${size(path)}) … `);
  try {
    /* Wrangler is invoked through node directly rather than through npx.
       npx needs a shell on Windows, and a shell re-splits every argument
       on spaces — which is most of these filenames. */
    execFileSync(process.execPath, [
      WRANGLER,
      /* the key is slugged, not the raw filename — spaces do not
         survive the trip into R2 intact */
      "r2", "object", "put", `${BUCKET}/${r2Key(file)}`,
      "--file", path,
      "--content-type", "audio/mpeg",
      local ? "--local" : "--remote",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    done += 1;
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    console.error(String(e.stderr || e.message).trim());
  }
}

console.log(`\n${done}/${files.length} uploaded.`);
process.exit(done === files.length ? 0 : 1);
