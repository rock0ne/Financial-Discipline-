import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParsedStatementResult } from './statementParser';
import {
  groupPdfPageText,
  parsePdfStatementRows,
  type PdfTextCell,
  type PdfTextRow,
} from './pdfStatementParser';

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_TEXT_CELLS = 150_000;
const MAX_TEXT_CHARACTERS = 1_000_000;

function rejected(message: string): ParsedStatementResult {
  return { transactions: [], warnings: [message] };
}

export async function parsePdfStatementFile(
  file: File,
  displayPath: string
): Promise<ParsedStatementResult> {
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return rejected('PDF is empty or exceeds the 15 MiB local-import limit.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-') {
    return rejected('File does not have a valid PDF header.');
  }

  // The worker is bundled with the app; document bytes never go to a URL or service.
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(workerUrl, document.baseURI).href;
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    useWorkerFetch: false,
    stopAtErrors: true,
    disableAutoFetch: true,
    disableStream: true,
  });
  try {
    const documentProxy = await task.promise;
    if (documentProxy.numPages > MAX_PDF_PAGES) {
      return rejected('PDF exceeds the 100-page local-import limit.');
    }
    const rows: PdfTextRow[] = [];
    let cellCount = 0;
    let textLength = 0;
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
      const page = await documentProxy.getPage(pageNumber);
      const content = await page.getTextContent();
      const cells: PdfTextCell[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const text = item.str.trim();
        if (!text) continue;
        cellCount++;
        textLength += text.length;
        if (cellCount > MAX_TEXT_CELLS || textLength > MAX_TEXT_CHARACTERS) {
          return rejected('PDF text exceeds the local-import safety limit.');
        }
        cells.push({
          text,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
        });
      }
      rows.push(...groupPdfPageText(pageNumber, cells));
      page.cleanup();
    }
    return parsePdfStatementRows(rows, displayPath);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      return rejected('Password-protected PDFs are not supported. Export CSV/OFX or an unprotected text PDF from your bank.');
    }
    return rejected('This PDF could not be read safely. It may be damaged, scanned, encrypted or use an unsupported layout.');
  } finally {
    await task.destroy();
  }
}
