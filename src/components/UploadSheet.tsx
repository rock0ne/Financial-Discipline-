import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
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
import { redactImportDisplayText } from '../utils/displayPrivacy';
import {
  applyConfirmedPdfAccountLabels,
  getImportReviewBlockers,
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
  ) => { added: number; skipped: number; legacySampleSettingsReview?: boolean } |
    Promise<{ added: number; skipped: number; legacySampleSettingsReview?: boolean }>;
  onVerifyImportStatus?: (
    meta: StatementImportMeta[]
  ) => Promise<'saved' | 'absent' | 'unknown'>;
}

const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.ofx', '.qfx', '.json', '.pdf'];
const MAX_INPUT_FILES = 200;
const MAX_TOTAL_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_INPUT_BYTES = 20 * 1024 * 1024;

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
    return new Promise((resolve, reject) => {
      entry.file!(
        (file) => {
          const cleanPath = (entry.fullPath || file.name).replace(/^\/+/, '');
          resolve([{ file, displayPath: cleanPath }]);
        },
        () => reject(new Error('A selected file could not be enumerated.'))
      );
    });
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const allEntries: WebkitFileSystemEntry[] = [];

    // readEntries returns batches (often max 100) until an empty batch is returned
    while (true) {
      const batch = await new Promise<WebkitFileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => reject(new Error('A selected folder could not be fully enumerated.'))
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
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [reviewedPdf, setReviewedPdf] = useState(false);
  const [pdfAccountLabels, setPdfAccountLabels] = useState<Record<string, string>>({});
  const [bulkPdfAccountLabel, setBulkPdfAccountLabel] = useState('');
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [resultBanner, setResultBanner] = useState<string | null>(null);
  const [pdfPeriodStart, setPdfPeriodStart] = useState('');
  const [pdfPeriodEnd, setPdfPeriodEnd] = useState('');
  const [showPdfPeriodControls, setShowPdfPeriodControls] = useState(false);
  const [lastSelectedItems, setLastSelectedItems] = useState<
    Array<{ file: File; displayPath: string }>
  >([]);
  const [lastFromFolder, setLastFromFolder] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const pdfReviewRef = useRef<HTMLDivElement | null>(null);
  const partialReviewRef = useRef<HTMLLabelElement | null>(null);
  const busyRef = useRef(false);
  const uncertainRef = useRef(false);

  // Set webkitdirectory / directory attributes imperatively for cross-browser folder selection
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, [open]);

  useEffect(() => {
    if (open) setReplaceExisting(isSampleData);
  }, [open, isSampleData]);

  useEffect(() => {
    if (open || uncertainRef.current) return;
    setPdfPeriodStart('');
    setPdfPeriodEnd('');
    setLastSelectedItems([]);
    setStagedTransactions([]);
    setStagedMeta([]);
    setWarnings([]);
    setFailedFiles(0);
    setAcceptPartial(false);
    setReviewedPdf(false);
    setPdfAccountLabels({});
    setBulkPdfAccountLabel('');
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

  const pdfMetas = stagedMeta.filter((meta) => meta.fileName.toLowerCase().endsWith('.pdf'));
  const pdfPreviewRows = stagedTransactions.filter((tx) => tx.sourceFile?.toLowerCase().endsWith('.pdf'));
  const missingPdfLabels = pdfMetas.filter((meta) =>
    !isValidPdfAccountLabel(pdfAccountLabels[meta.id])
  ).length;
  const pdfLabelsValid = missingPdfLabels === 0;
  const importReviewBlockers = getImportReviewBlockers({
    pdfCount: pdfMetas.length,
    missingPdfLabels,
    reviewedPdf,
    failedFiles,
    acceptPartial,
  });
  const importReviewMessage = [
    ...(importReviewBlockers.includes('pdf_labels')
      ? [`label ${missingPdfLabels} PDF${missingPdfLabels === 1 ? '' : 's'}`]
      : []),
    ...(importReviewBlockers.includes('pdf_review') ? ['confirm PDF row review'] : []),
    ...(importReviewBlockers.includes('partial_import') ? ['confirm partial import'] : []),
  ].join('; ');

  const jumpToRequiredReview = () => {
    const target = importReviewBlockers.includes('pdf_labels') || importReviewBlockers.includes('pdf_review')
      ? pdfReviewRef.current
      : partialReviewRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!open) return null;

  const processCollectedFiles = async (
    items: Array<{ file: File; displayPath: string }>,
    fromFolder: boolean,
    periodOverride?: { start?: string; end?: string }
  ) => {
    if (items.length === 0 || busyRef.current || uncertainRef.current) return;
    busyRef.current = true;
    setScanning(true);
    setLastSelectedItems(items);
    setLastFromFolder(fromFolder);

    const activePeriodStart = (periodOverride?.start ?? pdfPeriodStart).trim() || undefined;
    const activePeriodEnd = (periodOverride?.end ?? pdfPeriodEnd).trim() || undefined;

    try {
      if (
        items.length > MAX_INPUT_FILES ||
        items.reduce((total, item) => total + item.file.size, 0) > MAX_TOTAL_INPUT_BYTES
      ) {
        setWarnings(['Selection exceeds the 200-file or 50 MiB local-import limit. No files were staged.']);
        setStagedTransactions([]);
        setStagedMeta([]);
        setFailedFiles(0);
        setPdfAccountLabels({});
        return;
      }
      const supported = items
        .filter(({ file }) => isSupportedStatementFile(file.name))
        .sort((a, b) => a.displayPath.localeCompare(b.displayPath));
      const skippedUnsupported = items.length - supported.length;

      const pdfCount = supported.filter(({ file }) => file.name.toLowerCase().endsWith('.pdf')).length;
      if (activePeriodStart || activePeriodEnd) {
        if (!activePeriodStart || !activePeriodEnd || activePeriodStart > activePeriodEnd || pdfCount !== 1) {
          setStagedTransactions([]);
          setStagedMeta([]);
          setWarnings(['A manual PDF period needs both valid dates and exactly one selected PDF. Import multi-month folders with automatic period detection, or select the exceptional PDF separately.']);
          return;
        }
      }

      const allParsed: Transaction[] = [];
      const metas: StatementImportMeta[] = [];
      const allWarnings: string[] = [];
      let failed = 0;

      if (supported.length === 0) {
        allWarnings.push(
          'No supported statement files (.pdf, .csv, .tsv, .ofx, .qfx, .json) were found in the selected folder or files.'
        );
      }

      for (const { file, displayPath } of supported) {
        const safeDisplayPath = redactImportDisplayText(displayPath);
        try {
        const isPdf = file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf && file.size > MAX_TEXT_INPUT_BYTES) {
          failed++;
          allWarnings.push(`${safeDisplayPath}: File exceeds the 20 MiB text-statement limit.`);
          continue;
        }
        const { transactions, warnings: w } = isPdf
          ? await parsePdfStatementFile(file, safeDisplayPath, {
              statementPeriodStart: activePeriodStart,
              statementPeriodEnd: activePeriodEnd,
              defaultCurrency: primaryCurrency,
            })
          : parseStatementContent(await file.text(), safeDisplayPath);

        allWarnings.push(...w.map((msg) => redactImportDisplayText(`${safeDisplayPath}: ${msg}`)));
        if (transactions.length > 0) {
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
            fileName: safeDisplayPath,
            importedAt: new Date().toISOString(),
            rowCount: transactions.length,
            duplicatesSkipped: 0,
            dateRangeStart: sortedDates[0],
            dateRangeEnd: sortedDates[sortedDates.length - 1],
          });
        } else {
          failed++;
          if (w.length === 0) allWarnings.push(`${safeDisplayPath}: No transaction rows were parsed.`);
        }
        } catch {
          failed++;
          allWarnings.push(`${safeDisplayPath}: Could not read this file. It was not staged.`);
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
      setAcceptPartial(false);
      setReviewedPdf(false);
      setPdfAccountLabels({});
      setBulkPdfAccountLabel('');
      setResultBanner(null);

      if (fromFolder || supported.some((s) => s.displayPath.includes('/'))) {
        const rootFolder = supported[0]?.displayPath.split('/')[0];
        const parts = [
          rootFolder ? `Folder "${redactImportDisplayText(rootFolder)}"` : 'Folder scan',
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
    } catch {
      setStagedTransactions([]);
      setStagedMeta([]);
      setFailedFiles(0);
      setWarnings(['The selected files could not be processed safely. Nothing was staged.']);
    } finally {
      setScanning(false);
      busyRef.current = false;
    }
  };

  const processFileList = async (fileList: FileList | File[], fromFolder = false) => {
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
      stagedTransactions.length === 0 || committing || scanning || busyRef.current ||
      uncertainRef.current || saveUncertain ||
      importReviewBlockers.length > 0
    ) return;
    busyRef.current = true;
    setCommitting(true);
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
      const { added, skipped, legacySampleSettingsReview } = await onCommitImport(
        finalizedTransactions,
        stagedMeta,
        replaceExisting
      );
      setResultBanner(
        `Imported ${added} transaction${added === 1 ? '' : 's'} locally${
          appliedCount > 0 ? ` (${appliedCount} auto-categorized by rules engine)` : ''
        }${skipped > 0 ? ` · ${skipped} duplicates skipped` : ''}.`
      );
      if (legacySampleSettingsReview) {
        setWarnings([
          'Older fictional rows were removed. Some caps, recurring choices or ISA assumptions from a previously mixed ledger may remain; review Vault & Settings before relying on projections.',
        ]);
      }
      setStagedTransactions([]);
      setStagedMeta([]);
      setFolderSummary(null);
      setAcceptedSuggestionIds(new Set());
      setFailedFiles(0);
      setPdfAccountLabels({});
      setReviewedPdf(false);
      if (!legacySampleSettingsReview) {
        setTimeout(() => {
          setResultBanner(null);
          onClose();
        }, 900);
      }
    } catch {
      let status: 'saved' | 'absent' | 'unknown' = 'unknown';
      try {
        status = onVerifyImportStatus
          ? await onVerifyImportStatus(stagedMeta)
          : 'unknown';
      } catch {
        status = 'unknown';
      }
      if (status === 'saved') {
        setResultBanner('Local vault readback confirmed this import was saved. Do not retry the same batch.');
        setStagedTransactions([]);
        setStagedMeta([]);
        setFolderSummary(null);
        setAcceptedSuggestionIds(new Set());
        setFailedFiles(0);
        setPdfAccountLabels({});
        setReviewedPdf(false);
        setTimeout(() => {
          setResultBanner(null);
          onClose();
        }, 900);
      } else if (status === 'absent') {
        setWarnings((prev) => [
          ...prev,
          'Local vault readback found no receipt for this batch. Staged rows remain available for a safe retry.',
        ]);
      } else {
        uncertainRef.current = true;
        setSaveUncertain(true);
        setWarnings((prev) => [
          ...prev,
          'Local vault readback could not verify whether this batch committed. Retry is disabled. Reload and inspect Statements before selecting the files again.',
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
              Supports PDF, CSV, TSV, OFX, QFX, and JSON bank statements from UK, US, and EU banks
            </p>
          </div>
          <button
            type="button"
            disabled={scanning || committing}
            onClick={() => { if (!busyRef.current) onClose(); }}
            aria-label="Close import dialog"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
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
              try {
                const extracted = await extractDroppedFiles(e.dataTransfer);
                const hasFolderPaths = extracted.some((item) => item.displayPath.includes('/'));
                await processCollectedFiles(extracted, hasFolderPaths);
              } catch {
                setStagedTransactions([]);
                setStagedMeta([]);
                setWarnings(['The dropped folder could not be fully read. Nothing was staged; choose the folder again.']);
              }
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
                ? 'Parsing statements locally…'
                : 'Drop PDF or CSV statement files, or a whole statements folder here'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Select text-based PDF, CSV, OFX, QFX, or JSON statements (single files or a multi-month folder). Yearless PDF dates and same-day rows are resolved automatically.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.csv,.tsv,.ofx,.qfx,.json,application/pdf"
              onChange={(e) => {
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
                disabled={scanning}
                onClick={() => folderInputRef.current?.click()}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Choose Statement Folder
              </button>
              <button
                type="button"
                disabled={scanning}
                onClick={() => inputRef.current?.click()}
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
              checked={isSampleData || replaceExisting}
              disabled={isSampleData}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-teal-700"
            />
            <span>
              <strong>Replace existing ledger</strong>{isSampleData
                ? ' (required: importing real statements removes the fictional sample and its sample-only settings).'
                : ' (uncheck to merge additional months of your real statements).'}
            </span>
          </label>

          {/* Optional PDF Statement Period Override (only needed if a PDF omits all years) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => setShowPdfPeriodControls((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                PDF statement period override (optional — auto-detected by default)
              </span>
              <span className="text-[11px] text-teal-700 dark:text-teal-400">
                {showPdfPeriodControls ? 'Hide' : pdfPeriodStart || pdfPeriodEnd ? 'Active' : 'Set dates'}
              </span>
            </button>
            {showPdfPeriodControls && (
              <div className="mt-3 pt-2.5 border-t border-slate-200/70 dark:border-slate-800 space-y-2.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Statement dates are inferred automatically from the PDF header or filename. For one exceptional PDF with yearless dates, set its inclusive start and end dates, then select that PDF alone.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="pdf-period-start"
                      className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                    >
                      Period Start
                    </label>
                    <input
                      id="pdf-period-start"
                      type="date"
                      value={pdfPeriodStart}
                      onChange={(e) => setPdfPeriodStart(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="pdf-period-end"
                      className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                    >
                      Period End
                    </label>
                    <input
                      id="pdf-period-end"
                      type="date"
                      value={pdfPeriodEnd}
                      onChange={(e) => setPdfPeriodEnd(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(pdfPeriodStart || pdfPeriodEnd) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPdfPeriodStart('');
                        setPdfPeriodEnd('');
                        if (lastSelectedItems.length > 0) {
                          void processCollectedFiles(lastSelectedItems, lastFromFolder, {
                            start: '',
                            end: '',
                          });
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Clear dates
                    </button>
                  )}
                  {lastSelectedItems.some((item) => item.file.name.toLowerCase().endsWith('.pdf')) && (
                    <button
                      type="button"
                      disabled={scanning}
                      onClick={() => {
                        void processCollectedFiles(lastSelectedItems, lastFromFolder, {
                          start: pdfPeriodStart,
                          end: pdfPeriodEnd,
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-[11px] font-medium cursor-pointer"
                    >
                      Re-parse PDF with Period
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

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
                  onClick={() => {
                    setStagedTransactions([]);
                    setStagedMeta([]);
                    setFolderSummary(null);
                    setAcceptedSuggestionIds(new Set());
                    setWarnings([]);
                    setFailedFiles(0);
                    setAcceptPartial(false);
                    setReviewedPdf(false);
                    setPdfAccountLabels({});
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
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

          {pdfMetas.length > 0 && (
            <div ref={pdfReviewRef} className="rounded-xl border border-teal-200 dark:border-teal-900 p-4 space-y-3 text-xs">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">Confirm PDF account and transaction rows</p>
                <p className="mt-1 text-slate-600 dark:text-slate-400">
                  Use the same descriptive label for monthly statements from the same account. Import different accounts in separate batches or edit each label. Do not enter account or sort-code digits.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={bulkPdfAccountLabel}
                  onChange={(event) => setBulkPdfAccountLabel(event.target.value)}
                  placeholder="For example: Everyday current account"
                  aria-label="Account label for all selected PDFs"
                  maxLength={64}
                  className="min-w-0 flex-1 min-h-[40px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <button
                  type="button"
                  disabled={!isValidPdfAccountLabel(bulkPdfAccountLabel)}
                  onClick={() => setPdfAccountLabels(Object.fromEntries(pdfMetas.map((meta) => [meta.id, bulkPdfAccountLabel.trim()])))}
                  className="px-3 rounded-lg border border-teal-600 text-teal-800 dark:text-teal-300 disabled:opacity-40"
                >
                  Apply to all PDFs
                </button>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-2">
                {pdfMetas.map((meta) => (
                  <label key={meta.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span className="sm:w-1/2 truncate" title={meta.fileName}>{meta.fileName}</span>
                    <input
                      type="text"
                      value={pdfAccountLabels[meta.id] ?? ''}
                      onChange={(event) => setPdfAccountLabels((previous) => ({ ...previous, [meta.id]: event.target.value }))}
                      placeholder="Stable account label required"
                      aria-label={`Account label for ${meta.fileName}`}
                      maxLength={64}
                      className="min-w-0 flex-1 min-h-[38px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </label>
                ))}
              </div>
              {!pdfLabelsValid && <p className="text-amber-700 dark:text-amber-300">Every PDF needs a 2–64 character stable label, without a long digit run.</p>}
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">Parsed PDF rows — check against the original statement</p>
                <div className="mt-1 max-h-52 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full min-w-[530px] text-left">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2 text-right">Signed amount</th><th className="p-2">Currency</th></tr></thead>
                    <tbody>
                      {pdfPreviewRows.map((tx) => (
                        <tr key={tx.id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="p-2 whitespace-nowrap">{tx.date}</td>
                          <td className="p-2">{tx.description}</td>
                          <td className="p-2 text-right whitespace-nowrap">{tx.amount.toFixed(2)}</td>
                          <td className="p-2">{tx.currency ?? primaryCurrency}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <label className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={reviewedPdf} onChange={(event) => setReviewedPdf(event.target.checked)} className="mt-0.5" />
                <span>I checked the PDF dates, descriptions, signed amounts and currencies against my original statements.</span>
              </label>
            </div>
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

          {failedFiles > 0 && stagedTransactions.length > 0 && (
            <label ref={partialReviewRef} className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
              <input type="checkbox" checked={acceptPartial} onChange={(event) => setAcceptPartial(event.target.checked)} className="mt-0.5" />
              <span>{failedFiles} supported file{failedFiles === 1 ? '' : 's'} failed or contained no usable transactions. I understand only the successfully parsed files will be imported.</span>
            </label>
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
              Statement parsing runs locally; PDF bytes are not uploaded. AI Advisor is a separate, optional feature with its own outbound-data review.
            </span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/70 dark:bg-slate-950/40">
          {stagedTransactions.length > 0 && importReviewBlockers.length > 0 ? (
            <div className="min-w-0 text-[11px] text-amber-800 dark:text-amber-200">
              <p id="import-review-requirements" aria-live="polite">Before Analyze: {importReviewMessage}.</p>
              <button type="button" onClick={jumpToRequiredReview} className="underline underline-offset-2 font-medium cursor-pointer">
                Go to required review
              </button>
            </div>
          ) : <span />}
          <div className="flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            disabled={scanning || committing}
            onClick={() => { if (!busyRef.current) onClose(); }}
            className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
          >
            {resultBanner && stagedTransactions.length === 0 ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={stagedTransactions.length === 0 || committing || scanning || saveUncertain ||
              importReviewBlockers.length > 0}
            aria-describedby={stagedTransactions.length > 0 && importReviewBlockers.length > 0
              ? 'import-review-requirements'
              : undefined}
            onClick={() => void handleConfirm()}
            className="min-h-[42px] px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            {committing
              ? 'Saving to Vault…'
              : `Analyze ${stagedTransactions.length > 0 ? `${stagedTransactions.length} Rows` : 'Statements'}`}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
