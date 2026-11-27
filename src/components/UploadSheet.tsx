import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FolderOpen,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  CATEGORIES,
  type AdvancedAutomationRule,
  type CategoryRule,
  type CurrencyCode,
  type ExchangeRateTable,
  type StatementImportMeta,
  type Transaction,
} from '../types/finance';
import { exportTransactionsToCsv, parseStatementContent } from '../utils/statementParser';
import { parsePdfStatementFile } from '../utils/pdfStatementReader';
import {
  applyConfirmedPdfAccountLabels,
  isValidPdfAccountLabel,
} from '../utils/importCommit';
import { generateSample14MonthData } from '../utils/sampleData';
import {
  applyCategorySuggestions,
  suggestCategoryMappings,
} from '../utils/analyticsEngine';

interface UploadSheetProps {
  open: boolean;
  isSampleData: boolean;
  existingTransactions: Transaction[];
  savedRules?: CategoryRule[];
  advancedRules?: AdvancedAutomationRule[];
  primaryCurrency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  onClose: () => void;
  onCommitImport: (
    transactions: Transaction[],
    meta: StatementImportMeta[],
    replaceExisting: boolean
  ) => Promise<{ added: number; skipped: number }>;
  onVerifyImportStatus: (
    meta: StatementImportMeta[]
  ) => Promise<'saved' | 'absent' | 'unknown'>;
}

const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.ofx', '.qfx', '.json', '.pdf'];
const MAX_INPUT_FILES = 200;
const MAX_TOTAL_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_INPUT_BYTES = 20 * 1024 * 1024;
const PDF_PREVIEW_PAGE_SIZE = 40;

function isSupportedStatementFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.startsWith('.') || lower.startsWith('._')) return false;
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: WebkitFileSystemEntry[]) => void,
      error?: (err: unknown) => void
    ) => void;
  };
}

async function readDirectoryEntriesRecursive(
  entry: WebkitFileSystemEntry
): Promise<Array<{ file: File; displayPath: string }>> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file!(
        (file) => {
          const cleanPath = (entry.fullPath || file.name).replace(/^\/+/, '');
          resolve([{ file, displayPath: cleanPath }]);
        },
        () => resolve([])
      );
    });
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const allEntries: WebkitFileSystemEntry[] = [];

    // readEntries returns batches (often max 100) until an empty batch is returned
    while (true) {
      const batch = await new Promise<WebkitFileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([])
        );
      });
      if (batch.length === 0) break;
      allEntries.push(...batch);
    }

    const nested: Array<{ file: File; displayPath: string }> = [];
    for (const child of allEntries) {
      const childFiles = await readDirectoryEntriesRecursive(child);
      nested.push(...childFiles);
    }
    return nested;
  }

  return [];
}

async function extractDroppedFiles(
  dataTransfer: DataTransfer
): Promise<Array<{ file: File; displayPath: string }>> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries: WebkitFileSystemEntry[] = [];

  for (const item of items) {
    const withEntry = item as DataTransferItem & {
      webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
    };
    if (typeof withEntry.webkitGetAsEntry === 'function') {
      const entry = withEntry.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
  }

  if (entries.length > 0) {
    const collected: Array<{ file: File; displayPath: string }> = [];
    for (const entry of entries) {
      const found = await readDirectoryEntriesRecursive(entry);
      collected.push(...found);
    }
    return collected;
  }

  return Array.from(dataTransfer.files ?? []).map((file) => ({
    file,
    displayPath:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

export const UploadSheet: React.FC<UploadSheetProps> = ({
  open,
  isSampleData,
  existingTransactions,
  savedRules = [],
  advancedRules = [],
  primaryCurrency,
  exchangeRates,
  onClose,
  onCommitImport,
  onVerifyImportStatus,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(isSampleData);
  const [stagedTransactions, setStagedTransactions] = useState<Transaction[]>([]);
  const [stagedMeta, setStagedMeta] = useState<StatementImportMeta[]>([]);
  const [folderSummary, setFolderSummary] = useState<string | null>(null);
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState<Set<string>>(
    () => new Set()
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [failedFiles, setFailedFiles] = useState(0);
  const [hasStagedPdf, setHasStagedPdf] = useState(false);
  const [reviewedPdf, setReviewedPdf] = useState(false);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [pdfPreviewPage, setPdfPreviewPage] = useState(0);
  const [pdfAccountLabels, setPdfAccountLabels] = useState<Record<string, string>>({});
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [resultBanner, setResultBanner] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const uncertainRef = useRef(false);

  // Set webkitdirectory / directory attributes imperatively for cross-browser folder selection
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, [open]);

  const suggestions = useMemo(() => {
    if (stagedTransactions.length === 0) return [];
    return suggestCategoryMappings(
      stagedTransactions,
      existingTransactions,
      savedRules,
      advancedRules,
      primaryCurrency,
      exchangeRates
    );
  }, [
    stagedTransactions,
    existingTransactions,
    savedRules,
    advancedRules,
    primaryCurrency,
    exchangeRates,
  ]);

  const detectedCurrencies = useMemo(() => {
    const set = new Set<CurrencyCode>();
    for (const tx of stagedTransactions) {
      set.add(tx.currency ?? primaryCurrency);
    }
    return Array.from(set);
  }, [stagedTransactions, primaryCurrency]);

  const pdfPreviewRows = useMemo(
    () => stagedTransactions.filter((tx) => tx.sourceFile?.toLowerCase().endsWith('.pdf')),
    [stagedTransactions]
  );
  const pdfMetas = useMemo(
    () => stagedMeta.filter((meta) => meta.fileName.toLowerCase().endsWith('.pdf')),
    [stagedMeta]
  );
  const pdfLabelsValid = pdfMetas.every((meta) =>
    isValidPdfAccountLabel(pdfAccountLabels[meta.id])
  );
  const knownAccountNames = useMemo(
    () => isSampleData
      ? []
      : [...new Set(existingTransactions.map((tx) => tx.accountName.trim()).filter(Boolean))].slice(0, 50),
    [existingTransactions, isSampleData]
  );

  if (!open) return null;

  const processCollectedFiles = async (
    items: Array<{ file: File; displayPath: string }>,
    fromFolder: boolean
  ) => {
    if (items.length === 0 || busyRef.current || uncertainRef.current) return;
    busyRef.current = true;
    setScanning(true);
    setResultBanner(null);

    try {
      if (
        items.length > MAX_INPUT_FILES ||
        items.reduce((total, item) => total + item.file.size, 0) > MAX_TOTAL_INPUT_BYTES
      ) {
        setWarnings(['Selection exceeds the 200-file or 50 MiB local-import limit. No files were staged.']);
        setStagedTransactions([]);
        setStagedMeta([]);
        setHasStagedPdf(false);
        setPdfAccountLabels({});
        setFailedFiles(0);
        return;
      }
      const supported = items
        .filter(({ file }) => isSupportedStatementFile(file.name))
        .sort((a, b) => a.displayPath.localeCompare(b.displayPath));
      const skippedUnsupported = items.length - supported.length;

      const allParsed: Transaction[] = [];
      const metas: StatementImportMeta[] = [];
      const allWarnings: string[] = [];
      let failed = 0;
      let pdfParsed = false;

      if (supported.length === 0) {
        allWarnings.push(
          'No supported statement files (.csv, .tsv, .ofx, .qfx, .json, .pdf) were found in the selected folder or files.'
        );
      }

      for (const { file, displayPath } of supported) {
        try {
          const isPdf = file.name.toLowerCase().endsWith('.pdf');
          if (!isPdf && file.size > MAX_TEXT_INPUT_BYTES) {
            failed++;
            allWarnings.push(`${displayPath}: File exceeds the 20 MiB text-statement limit.`);
            continue;
          }
          const result = isPdf
            ? await parsePdfStatementFile(file, displayPath)
            : parseStatementContent(await file.text(), displayPath);
          const { transactions, warnings: fileWarnings } = result;
          allWarnings.push(...fileWarnings.map((msg) => `${displayPath}: ${msg}`));
          if (transactions.length === 0) {
            failed++;
            if (fileWarnings.length === 0) {
              allWarnings.push(`${displayPath}: No transaction rows were parsed.`);
            }
            continue;
          }
          if (isPdf) pdfParsed = true;
          const batchId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const sortedDates = transactions.map((t) => t.date).sort();
          allParsed.push(
            ...transactions.map((t) => ({
              ...t,
              importBatchId: batchId,
            }))
          );
          metas.push({
            id: batchId,
            fileName: displayPath,
            importedAt: new Date().toISOString(),
            rowCount: transactions.length,
            duplicatesSkipped: 0,
            dateRangeStart: sortedDates[0],
            dateRangeEnd: sortedDates[sortedDates.length - 1],
          });
        } catch {
          failed++;
          allWarnings.push(`${displayPath}: Could not read this file. It was not staged.`);
        }
      }

      const initialSuggestions = suggestCategoryMappings(
        allParsed,
        existingTransactions,
        savedRules,
        advancedRules,
        primaryCurrency,
        exchangeRates
      );
      setStagedTransactions(allParsed);
      setStagedMeta(metas);
      setAcceptedSuggestionIds(new Set(initialSuggestions.map((s) => s.transactionId)));
      setWarnings(allWarnings);
      setFailedFiles(failed);
      setHasStagedPdf(pdfParsed);
      setReviewedPdf(false);
      setAcceptPartial(false);
      setPdfPreviewPage(0);
      setPdfAccountLabels({});

      if (fromFolder || supported.some((s) => s.displayPath.includes('/'))) {
        const rootFolder = supported[0]?.displayPath.split('/')[0];
        const parts = [
          rootFolder ? `Folder "${rootFolder}"` : 'Folder scan',
          `${metas.length} statement file${metas.length === 1 ? '' : 's'} parsed`,
        ];
        if (failed > 0) parts.push(`${failed} supported file${failed === 1 ? '' : 's'} failed`);
        if (skippedUnsupported > 0) {
          parts.push(
            `${skippedUnsupported} non-statement file${skippedUnsupported === 1 ? '' : 's'} ignored`
          );
        }
        setFolderSummary(parts.join(' · '));
      } else {
        setFolderSummary(null);
      }
    } finally {
      setScanning(false);
      busyRef.current = false;
    }
  };

  const processFileList = async (fileList: FileList | File[], fromFolder = false) => {
    if (busyRef.current || uncertainRef.current) return;
    const items = Array.from(fileList).map((file) => ({
      file,
      displayPath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    await processCollectedFiles(items, fromFolder);
  };

  const toggleSuggestion = (txId: string) => {
    setAcceptedSuggestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (
      busyRef.current ||
      uncertainRef.current ||
      stagedTransactions.length === 0 ||
      scanning ||
      committing ||
      (hasStagedPdf && !reviewedPdf) ||
      (hasStagedPdf && !pdfLabelsValid) ||
      saveUncertain ||
      (failedFiles > 0 && !acceptPartial)
    ) return;
    busyRef.current = true;
    setCommitting(true);
    setResultBanner(null);
    const appliedCount = suggestions.filter((s) =>
      acceptedSuggestionIds.has(s.transactionId)
    ).length;

    try {
      const labeledTransactions = applyConfirmedPdfAccountLabels(
        stagedTransactions,
        pdfAccountLabels
      );
      const finalizedTransactions =
        suggestions.length > 0 && acceptedSuggestionIds.size > 0
          ? applyCategorySuggestions(labeledTransactions, suggestions, acceptedSuggestionIds)
          : labeledTransactions;
      const { added, skipped } = await onCommitImport(
        finalizedTransactions,
        stagedMeta,
        replaceExisting
      );
      setResultBanner(
        `Saved ${added} transaction${added === 1 ? '' : 's'} locally${
          appliedCount > 0 ? ` (${appliedCount} auto-categorized by rules engine)` : ''
        }${skipped > 0 ? ` · ${skipped} duplicates skipped` : ''}.`
      );
      setStagedTransactions([]);
      setStagedMeta([]);
      setFolderSummary(null);
      setAcceptedSuggestionIds(new Set());
      setHasStagedPdf(false);
      setPdfAccountLabels({});
      setFailedFiles(0);
      setTimeout(() => {
        setResultBanner(null);
        onClose();
      }, 900);
    } catch {
      const status = await onVerifyImportStatus(stagedMeta);
      if (status === 'saved') {
        setResultBanner('Local vault readback confirmed this import was saved. Do not retry the same batch.');
        setStagedTransactions([]);
        setStagedMeta([]);
        setPdfAccountLabels({});
        setHasStagedPdf(false);
        setTimeout(() => {
          setResultBanner(null);
          onClose();
        }, 1400);
      } else if (status === 'absent') {
        uncertainRef.current = false;
        setWarnings((previous) => [
          ...previous.filter((warning) => !warning.startsWith('Local vault save failed')),
          'Local vault save failed. Readback found no receipt for this batch; staged rows remain available for a safe retry.',
        ]);
      } else {
        uncertainRef.current = true;
        setSaveUncertain(true);
        setWarnings((previous) => [
          ...previous.filter((warning) => !warning.startsWith('Local vault save failed')),
          'Local vault save failed and readback could not verify whether it committed. Retry is disabled. Reload the app and inspect Statements before selecting these files again.',
        ]);
      }
    } finally {
      setCommitting(false);
      busyRef.current = false;
    }
  };

  const handleDownloadSampleCsv = () => {
    const sample = generateSample14MonthData();
    const csv = exportTransactionsToCsv(sample.transactions, primaryCurrency);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Sample_14Month_UK_Bank_Statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-sheet-title"
    >
      <div className="w-full sm:max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Mobile Drag Handle */}
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3" />

        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2
              id="upload-sheet-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Import Bank Statements (12+ Months)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              CSV, TSV, OFX, QFX, JSON and readable text-based PDF tables; scanned PDFs need a bank CSV/OFX export
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!busyRef.current) onClose(); }}
            disabled={committing}
            aria-label="Close import dialog"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragActive(false);
              if (busyRef.current || uncertainRef.current) return;
              const extracted = await extractDroppedFiles(e.dataTransfer);
              const hasFolderPaths = extracted.some((item) => item.displayPath.includes('/'));
              await processCollectedFiles(extracted, hasFolderPaths);
            }}
            className={`rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors ${
              dragActive
                ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30'
                : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/50'
            }`}
          >
            <Upload className="w-7 h-7 text-teal-700 dark:text-teal-400 mx-auto" />
            <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              {scanning
                ? 'Scanning statements folder locally…'
                : 'Drop statement files or an entire statements folder here'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Choose files or a folder of statements. PDFs are parsed on this device and require row-by-row review; password-protected or image-only PDFs are not supported.
            </p>
            <input
              ref={inputRef}
              type="file"
              data-testid="statement-files-input"
              multiple
              accept=".csv,.tsv,.ofx,.qfx,.json,.pdf"
              onChange={(e) => {
                if (busyRef.current || uncertainRef.current) return;
                if (e.target.files) {
                  void processFileList(e.target.files, false);
                  e.target.value = '';
                }
              }}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={(e) => {
                if (busyRef.current || uncertainRef.current) return;
                if (e.target.files) {
                  void processFileList(e.target.files, true);
                  e.target.value = '';
                }
              }}
              className="hidden"
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={scanning || committing || saveUncertain}
                onClick={() => { if (!busyRef.current && !uncertainRef.current) folderInputRef.current?.click(); }}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Choose Statement Folder
              </button>
              <button
                type="button"
                disabled={scanning || committing || saveUncertain}
                onClick={() => { if (!busyRef.current && !uncertainRef.current) inputRef.current?.click(); }}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
              >
                Choose Files
              </button>
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Sample CSV
              </button>
            </div>
          </div>

          {/* Merge vs Replace Option */}
          <label className="flex items-start gap-3 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={replaceExisting}
              disabled={committing}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-teal-700"
            />
            <span>
              <strong>Replace existing ledger</strong> (recommended when replacing the built-in 14-month sample with your own bank statements; uncheck to merge additional months).
            </span>
          </label>

          {/* Parse Preview */}
          {stagedMeta.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                    <FileSpreadsheet className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                    Ready to import ({stagedTransactions.length} transactions across{' '}
                    {stagedMeta.length} file{stagedMeta.length === 1 ? '' : 's'})
                  </span>
                  {(folderSummary || detectedCurrencies.length > 1) && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {[
                        folderSummary,
                        detectedCurrencies.length > 1
                          ? `Mixed currencies detected: ${detectedCurrencies.join(', ')} (auto-converted to ${primaryCurrency})`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={scanning || committing}
                  onClick={() => {
                    if (busyRef.current) return;
                    setStagedTransactions([]);
                    setStagedMeta([]);
                    setFolderSummary(null);
                    setAcceptedSuggestionIds(new Set());
                    setWarnings([]);
                    setFailedFiles(0);
                    setHasStagedPdf(false);
                    setReviewedPdf(false);
                    setAcceptPartial(false);
                    setPdfPreviewPage(0);
                    setPdfAccountLabels({});
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-44 overflow-y-auto pr-1">
                {stagedMeta.map((m) => (
                  <div key={m.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="text-slate-700 dark:text-slate-300 truncate" title={m.fileName}>
                      {m.fileName}
                    </span>
                    <span className="font-mono-num text-slate-500 shrink-0">
                      {m.rowCount} rows · {m.dateRangeStart} → {m.dateRangeEnd}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasStagedPdf && pdfPreviewRows.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-700 p-4 space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Review PDF transactions against the original statement
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Check dates, debit/credit signs, amounts, currency and account. PDF layouts vary by bank. Nothing is saved until you confirm below.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-amber-900 dark:text-amber-200">
                  Enter a stable label for each bank account. Use the same label for later statements or renamed downloads of that account, and a different label for a different account. File names are not account identities.
                </p>
                <datalist id="known-clearledger-accounts">
                  {knownAccountNames.map((name) => <option key={name} value={name} />)}
                </datalist>
                {pdfMetas.map((meta) => (
                  <label key={meta.id} className="block text-xs text-slate-700 dark:text-slate-300">
                    Account label for {meta.fileName}
                    <input
                      type="text"
                      list="known-clearledger-accounts"
                      maxLength={64}
                      disabled={committing}
                      value={pdfAccountLabels[meta.id] ?? ''}
                      onChange={(event) => {
                        setPdfAccountLabels((previous) => ({
                          ...previous,
                          [meta.id]: event.target.value,
                        }));
                        setReviewedPdf(false);
                      }}
                      placeholder="e.g. Main current account"
                      className="mt-1 w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </label>
                ))}
                {!pdfLabelsValid && (
                  <p className="text-[11px] text-amber-900 dark:text-amber-200">
                    Every PDF needs a 2–64 character account label; do not use the vertical bar character.
                  </p>
                )}
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="min-w-full text-[11px] text-left">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                    <tr>
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Description</th>
                      <th className="px-2 py-1.5">Signed amount</th>
                      <th className="px-2 py-1.5">Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdfPreviewRows
                      .slice(
                        pdfPreviewPage * PDF_PREVIEW_PAGE_SIZE,
                        (pdfPreviewPage + 1) * PDF_PREVIEW_PAGE_SIZE
                      )
                      .map((tx) => (
                        <tr key={tx.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                          <td className="px-2 py-1.5 whitespace-nowrap">{tx.date}</td>
                          <td className="px-2 py-1.5 min-w-40">{tx.description}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap font-mono-num">
                            {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)} {tx.currency ?? primaryCurrency}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {pdfAccountLabels[tx.importBatchId ?? '']?.trim() || 'Label required'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {pdfPreviewRows.length > PDF_PREVIEW_PAGE_SIZE && (
                <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                  <span>
                    Rows {pdfPreviewPage * PDF_PREVIEW_PAGE_SIZE + 1}–
                    {Math.min((pdfPreviewPage + 1) * PDF_PREVIEW_PAGE_SIZE, pdfPreviewRows.length)} of {pdfPreviewRows.length}
                  </span>
                  <div className="flex gap-2">
                    <button type="button" disabled={pdfPreviewPage === 0} onClick={() => setPdfPreviewPage((page) => page - 1)} className="disabled:opacity-40 underline cursor-pointer">Previous</button>
                    <button type="button" disabled={(pdfPreviewPage + 1) * PDF_PREVIEW_PAGE_SIZE >= pdfPreviewRows.length} onClick={() => setPdfPreviewPage((page) => page + 1)} className="disabled:opacity-40 underline cursor-pointer">Next</button>
                  </div>
                </div>
              )}
              <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={reviewedPdf} disabled={committing || !pdfLabelsValid} onChange={(event) => setReviewedPdf(event.target.checked)} className="mt-0.5 w-4 h-4 accent-teal-700" />
                <span>I checked the PDF rows, signed amounts, currencies and stable account labels against my original statement.</span>
              </label>
            </div>
          )}

          {failedFiles > 0 && stagedTransactions.length > 0 && (
            <label className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200">
              <input type="checkbox" checked={acceptPartial} disabled={committing} onChange={(event) => setAcceptPartial(event.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-700" />
              <span>{failedFiles} selected supported file{failedFiles === 1 ? '' : 's'} did not parse and will be excluded. I understand that confirming imports only the staged files shown above.</span>
            </label>
          )}

          {/* Automated Rules Engine Suggestions Preview */}
          {suggestions.length > 0 && (
            <div className="rounded-xl border border-teal-200 dark:border-teal-800/80 bg-teal-50/40 dark:bg-teal-950/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-900 dark:text-teal-200">
                  <Sparkles className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                  <span>
                    Rules Engine Suggested {suggestions.length} Category Mapping
                    {suggestions.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setAcceptedSuggestionIds(new Set(suggestions.map((s) => s.transactionId)))
                    }
                    className="font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    Select all
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => setAcceptedSuggestionIds(new Set())}
                    className="font-medium text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
                  >
                    Skip all
                  </button>
                </div>
              </div>

              <div className="divide-y divide-teal-200/50 dark:divide-teal-900/60 max-h-44 overflow-y-auto text-xs">
                {suggestions.slice(0, 25).map((s) => {
                  const checked = acceptedSuggestionIds.has(s.transactionId);
                  return (
                    <label
                      key={s.transactionId}
                      className="py-2 first:pt-0 last:pb-0 flex items-start gap-2.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSuggestion(s.transactionId)}
                        className="mt-0.5 w-3.5 h-3.5 rounded accent-teal-700"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {s.merchant}
                          </span>
                          <span className="font-mono-num text-[11px] text-teal-800 dark:text-teal-300 shrink-0">
                            {CATEGORIES[s.currentCategory].label} →{' '}
                            <strong>{CATEGORIES[s.suggestedCategory].label}</strong>
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {s.reason} · {s.confidence}% confidence
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
              {suggestions.length > 25 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Showing first 25 of {suggestions.length} suggestions ({acceptedSuggestionIds.size}{' '}
                  selected).
                </p>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              {warnings.map((w, idx) => (
                <p key={idx}>{w}</p>
              ))}
            </div>
          )}

          {resultBanner && (
            <div className="p-3.5 rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-900 dark:text-teal-200">
              {resultBanner}
            </div>
          )}

          {/* Local Guarantee */}
          <div className="flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
            <span>
              Parsed exclusively inside your local browser runtime. Account numbers and transactions are never uploaded to any cloud or third-party agency.
            </span>
          </div>
        </div>

        <div className="pb-safe-4 px-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/70 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={() => { if (!busyRef.current) onClose(); }}
            disabled={committing}
            className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-statement-import"
            disabled={stagedTransactions.length === 0 || scanning || committing || saveUncertain || (hasStagedPdf && (!reviewedPdf || !pdfLabelsValid)) || (failedFiles > 0 && !acceptPartial)}
            onClick={() => { void handleConfirm(); }}
            className="min-h-[42px] px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            {committing ? 'Saving locally…' : `Analyze ${stagedTransactions.length > 0 ? `${stagedTransactions.length} Rows` : 'Statements'}`}
          </button>
        </div>
      </div>
    </div>
  );
};
