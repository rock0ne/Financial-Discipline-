import { registerPlugin } from '@capacitor/core';

interface NativeFolderEntry {
  id: number;
  name: string;
  displayPath: string;
  size: number;
}

type NativeFolderResult =
  | { status: 'cancelled' }
  | { status: 'selected'; token: string; ignoredCount: number; files: NativeFolderEntry[] };

interface StatementFolderPlugin {
  pickFolder(): Promise<NativeFolderResult>;
  readFile(options: { token: string; id: number }): Promise<{ dataBase64: string }>;
  release(options: { token: string }): Promise<{ released: boolean }>;
}

const nativeFolder = registerPlugin<StatementFolderPlugin>('StatementFolder');

export interface PickedStatementFolder {
  status: 'cancelled' | 'selected';
  items: Array<{ file: File; displayPath: string }>;
  ignoredCount: number;
  releaseUncertain: boolean;
}

function mimeFor(name: string): string {
  if (name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (name.toLowerCase().endsWith('.json')) return 'application/json';
  return 'text/plain';
}

export function decodePickedStatement(
  entry: NativeFolderEntry,
  dataBase64: string
): { file: File; displayPath: string } {
  if (!Number.isInteger(entry.id) || entry.id < 0 ||
      !entry.name || !entry.displayPath ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw new Error('A selected statement could not be read safely.');
  }
  const binary = atob(dataBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > 10_000_000) {
    throw new Error('A selected statement exceeded the supported size.');
  }
  return {
    file: new File([bytes], entry.name, { type: mimeFor(entry.name) }),
    displayPath: entry.displayPath,
  };
}

/** Android SAF access is held only while the selected files are read into memory. */
export async function pickNativeStatementFolder(): Promise<PickedStatementFolder> {
  const selection = await nativeFolder.pickFolder();
  if (selection.status === 'cancelled') {
    return { status: 'cancelled', items: [], ignoredCount: 0, releaseUncertain: false };
  }
  let releaseUncertain = false;
  let items: PickedStatementFolder['items'] = [];
  try {
    if (!selection.token || !Array.isArray(selection.files) || selection.files.length > 60) {
      throw new Error('The selected folder could not be read safely.');
    }
    for (const entry of selection.files) {
      const { dataBase64 } = await nativeFolder.readFile({ token: selection.token, id: entry.id });
      items.push(decodePickedStatement(entry, dataBase64));
    }
  } finally {
    // The plugin neither persists the URI grant nor keeps a filesystem path.
    try {
      const result = await nativeFolder.release({ token: selection.token ?? '' });
      releaseUncertain = result.released !== true;
    } catch {
      releaseUncertain = true;
    }
  }
  return {
    status: 'selected',
    items,
    ignoredCount: Math.max(0, Number(selection.ignoredCount) || 0),
    releaseUncertain,
  };
}
