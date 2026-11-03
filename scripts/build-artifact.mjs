/**
 * Builds a single self-contained HTML page for publishing as a Claude artifact (playtest link).
 * - JS and CSS are inlined (the artifact CSP only allows a few CDNs for external resources).
 * - The document skeleton (doctype/html/head/body) is stripped; the host adds its own.
 * - Manifest, icons and the service worker are left out (not supported in artifacts).
 * Usage: node scripts/build-artifact.mjs [outFile]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const outDir = 'dist-artifact';
const outFile = process.argv[2] ?? join(outDir, 'infra-manager.html');

execFileSync(
  'npx',
  ['vite', 'build', '--mode', 'artifact', '--base', './', '--outDir', outDir, '--emptyOutDir'],
  {
    stdio: 'inherit',
  },
);

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const read = (href) => readFileSync(join(outDir, href.replace(/^\.\//, '')), 'utf8');

const scripts = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)].map(
  (m) => m[1],
);
const styles = [...html.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)].map((m) => m[1]);
if (scripts.length !== 1) throw new Error(`expected one entry script, found ${scripts.length}`);

// Inline scripts must not contain a closing script tag.
const js = read(scripts[0]).replace(/<\/script/gi, '<\\/script');
const css = styles.map(read).join('\n');

const page = [
  '<title>Infra Manager</title>',
  '<meta name="description" content="複数の顧客のクラウドインフラを設計・運用する、学習用シミュレーションゲーム（試遊版）" />',
  `<style>\n${css}\n</style>`,
  '<div id="root"></div>',
  `<script type="module">\n${js}\n</script>`,
  '',
].join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, page);
console.log(`artifact page: ${outFile} (${Math.round(page.length / 1024)} KB)`);
