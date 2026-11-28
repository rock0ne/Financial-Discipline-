import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const viteCli = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteCli)) {
  console.error('Install dependencies before building the native app.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [viteCli, 'build'], {
  stdio: 'inherit',
  env: { ...process.env, CAPACITOR_BUILD: 'true' },
});
if (result.error) {
  console.error('Native web build failed:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

// A service worker in a packaged WebView can keep old screens alive after an
// APK upgrade. Native assets are already bundled, so fail the build if PWA
// output accidentally slips back into dist.
for (const file of ['sw.js', 'registerSW.js', 'manifest.webmanifest']) {
  if (existsSync(join(process.cwd(), 'dist', file))) {
    console.error(`Native build unexpectedly includes ${file}.`);
    process.exit(1);
  }
}

// Native builds do not use the hosted AI proxy. Limit their renderer to the
// bundled application, while leaving the Studio/web development CSP alone.
const indexPath = join(process.cwd(), 'dist', 'index.html');
const html = readFileSync(indexPath, 'utf8');
const charset = '<meta charset="UTF-8" />';
if (!html.includes(charset)) {
  console.error('Native build cannot locate the HTML charset for CSP insertion.');
  process.exit(1);
}
const nativeCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
writeFileSync(indexPath, html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${nativeCsp}" />`));
