import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
