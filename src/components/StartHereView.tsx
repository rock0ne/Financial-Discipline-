import React from 'react';
import { ArrowRight, FileText, HelpCircle, Scissors, Upload } from 'lucide-react';

interface StartHereViewProps {
  isSampleData: boolean;
  transactionCount: number;
  alertCount: number;
  onOpenImport: () => void;
  onNavigate: (tab: 'overview' | 'cuts' | 'faq') => void;
}

export const StartHereView: React.FC<StartHereViewProps> = ({
  isSampleData,
  transactionCount,
  alertCount,
  onOpenImport,
  onNavigate,
}) => {
  const hasOwnData = !isSampleData && transactionCount > 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700 dark:text-teal-400">
          Start here
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Understand your money in three steps.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
          Add a bank statement, check the result, then choose one thing to look at more closely. No bank connection needed.
        </p>
        <button type="button" onClick={onOpenImport} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
          Choose a statement <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 sm:p-5 dark:border-teal-900 dark:bg-teal-950/40">
        <p className="font-semibold text-teal-950 dark:text-teal-100">
          {isSampleData
            ? 'You are looking at practice numbers.'
            : hasOwnData
              ? 'Your imported statements are ready to explore.'
              : 'No statements have been added yet.'}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-teal-900 dark:text-teal-200">
          {isSampleData
            ? 'They are fictional. Your first real import replaces them, so they will not be mixed with your money.'
            : hasOwnData
              ? 'Clearledger works with the transactions saved on this device. Check the statement dates and totals before relying on a result.'
              : 'You can add a statement when you are ready. Clearledger cannot see your bank account by itself.'}
        </p>
      </div>

      {hasOwnData && alertCount > 0 && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {alertCount === 1
              ? 'One spending alert needs a look.'
              : `${alertCount} spending alerts need a look.`}{' '}
          <button type="button" onClick={() => onNavigate('overview')} className="min-h-11 font-semibold underline underline-offset-2">
            Open Overview to check
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <Upload className="h-6 w-6 text-teal-700 dark:text-teal-400" aria-hidden="true" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 1</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Add a statement</h2>
          <p className="mt-2 min-h-20 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Choose a PDF or another supported bank statement file. Review what was found before saving it.
          </p>
          <button type="button" onClick={onOpenImport} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            Choose a statement <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <FileText className="h-6 w-6 text-teal-700 dark:text-teal-400" aria-hidden="true" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 2</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">See the full picture</h2>
          <p className="mt-2 min-h-20 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            The Overview shows money in, money out and regular bills. Start there when you want more detail.
          </p>
          <button type="button" onClick={() => onNavigate('overview')} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">
            Open Overview <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <Scissors className="h-6 w-6 text-teal-700 dark:text-teal-400" aria-hidden="true" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 3</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Choose a next step</h2>
          <p className="mt-2 min-h-20 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Look at possible savings. Clearledger suggests ideas; it never cancels a bill or moves money for you.
          </p>
          <button type="button" onClick={() => onNavigate('cuts')} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">
            Explore Cut &amp; Save <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">New to this? That is okay.</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            The simple Help page explains imports, practice numbers, privacy and what the buttons do.
          </p>
        </div>
        <button type="button" onClick={() => onNavigate('faq')} className="mt-4 inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800 sm:mt-0">
          <HelpCircle className="h-4 w-4" aria-hidden="true" /> Read simple Help
        </button>
      </div>

      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Clearledger does not connect to your bank or make financial decisions for you. Results are estimates based on the files you choose.
      </p>
    </div>
  );
};
