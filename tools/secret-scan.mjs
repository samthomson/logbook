import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const patterns = [
  ["Nostr secret key", /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{40,}\b/gi],
  ["encrypted Nostr secret", /\bncryptsec1[023456789acdefghjklmnpqrstuvwxyz]{40,}\b/gi],
  ["NIP-46 bunker URI", /\bbunker:\/\/[0-9a-f]{64}\?[^\s"'<>]+/gi],
  ["generic private-key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const findings = [];
for (const file of files) {
  let source;
  try {
    source = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found (values suppressed):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} tracked files).`);
