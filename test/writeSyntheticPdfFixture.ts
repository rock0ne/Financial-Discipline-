import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { makeSyntheticStatementPdf } from './syntheticPdfFixture';

const target = process.argv[2];
if (!target) throw new Error('Pass an explicit output PDF path.');
const resolved = resolve(target);
await mkdir(dirname(resolved), { recursive: true });
await writeFile(resolved, makeSyntheticStatementPdf(), { flag: 'wx' });
process.stdout.write(`Synthetic PDF fixture written: ${resolved}\n`);
