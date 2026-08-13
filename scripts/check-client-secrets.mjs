import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const envFile = path.join(root, '.env.local');

if (!fs.existsSync(dist)) throw new Error('dist/ does not exist. Run the production build first.');

const secrets = [];
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !/(?:API_KEY|SECRET|TOKEN|PASSWORD)$/i.test(match[1])) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (value && !/^(?:replace-|change-me|example)/i.test(value)) secrets.push({ name: match[1], value });
  }
}

const textFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:html|js|css|json|xml|txt|map)$/i.test(entry.name)) textFiles.push(file);
  }
}
walk(dist);

const leaked = new Set();
for (const file of textFiles) {
  const contents = fs.readFileSync(file, 'utf8');
  for (const secret of secrets) {
    if (contents.includes(secret.value)) leaked.add(secret.name);
  }
}

if (leaked.size > 0) {
  throw new Error(`Production build contains private values: ${[...leaked].join(', ')}`);
}

console.log(`Client-secret check passed (${textFiles.length} production text files inspected).`);
