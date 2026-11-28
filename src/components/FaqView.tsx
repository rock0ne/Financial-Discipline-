import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';

type FaqCategory = 'all' | 'ai_hygiene' | 'privacy' | 'statements' | 'sharing';

interface FaqItem {
  id: string;
  category: Exclude<FaqCategory, 'all'>;
  categoryLabel: string;
  question: string;
  answer: string;
  actionLabel?: string;
  actionTab?: 'ai' | 'vault' | 'reports' | 'ledger' | 'family' | 'overview';
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'byok-setup',
    category: 'ai_hygiene',
    categoryLabel: 'AI & Key Hygiene',
    question: 'How do I connect my own Gemini, Claude, or ChatGPT API key safely?',
    answer:
      'Only the separately hosted web-server mode supports Gemini, Claude, or ChatGPT through a server-side proxy. Configure GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY on that server, never in the app or a bank statement. The packaged Windows/Android preview has no AI provider connection and no on-device AI model; adding a key does not unlock AI there.',
    actionLabel: 'Open AI Advisor',
    actionTab: 'ai',
  },
  {
    id: 'timed-key-hygiene',
    category: 'ai_hygiene',
    categoryLabel: 'AI & Key Hygiene',
    question: 'How does timed AI access hygiene work when I no longer need AI advice?',
    answer:
      'In the separately hosted web-server mode, you can choose Single Query Only or a 15-minute, 1-hour, 7-day, or 30-day UI access window. When it expires or you turn AI Off, this app stops offering AI requests and clears cached advice. This does not revoke a server-side API key; remove or rotate that key separately. The packaged Windows/Android preview has no AI access window because AI is unavailable there.',
    actionLabel: 'Configure Session Timer',
    actionTab: 'ai',
  },
  {
    id: 'zero-pii-ai',
    category: 'ai_hygiene',
    categoryLabel: 'AI & Key Hygiene',
    question: 'Do Gemini, Claude, or ChatGPT ever see my bank statements or merchant names?',
    answer:
      'The packaged Windows/Android preview makes no AI-provider request. In the separately hosted web-server mode, statement parsing and analytics run locally; an explicit AI request sends a compact, allowlisted summary and your optional question to the chosen external provider. Inspect the summary first and use "Mask exact amounts" if needed. Do not enter personal or bank details in the question.',
    actionLabel: 'Inspect AI Firewall',
    actionTab: 'ai',
  },
  {
    id: 'local-encryption',
    category: 'privacy',
    categoryLabel: 'Privacy & Encryption',
    question: 'Where is my financial data stored and how is it encrypted?',
    answer:
      'The local vault uses IndexedDB on your browser, Windows device, or Android phone; it is not automatically synced to a cloud server. It is unencrypted until you enable a Vault Passphrase. With a passphrase, Clearledger derives a key using PBKDF2-SHA256 and encrypts the vault with AES-256-GCM before writing it to disk.',
    actionLabel: 'Manage Local Vault',
    actionTab: 'vault',
  },
  {
    id: 'offline-usage',
    category: 'privacy',
    categoryLabel: 'Privacy & Encryption',
    question: 'Can I use Clearledger completely offline without AI?',
    answer:
      'Yes. Statement imports, 12-month D3 spending trends, Essential vs. Non-Essential breakdowns, custom monthly spending caps, projected over-cap alerts, recurring subscription audits, Cash ISA / LISA compounding math, CSV exports, and jsPDF printable reports all run 100% locally with zero network requests.',
    actionLabel: 'Go to Overview',
    actionTab: 'overview',
  },
  {
    id: 'statement-formats',
    category: 'statements',
    categoryLabel: 'Statements & Reports',
    question: 'Which bank statement file formats can I upload, and how do I search them?',
    answer:
      'You can drag and drop 12 or more months of CSV, OFX, QFX, or JSON bank statements (Monzo, Starling, Barclays, HSBC, Lloyds, NatWest, Chase, Revolut, and standard CSV exports). Duplicates are skipped automatically. In the Statements tab, you can filter by description or merchant, minimum/maximum amount range, exact date range, or spending class, and export filtered or full CSV files anytime.',
    actionLabel: 'Open Statements Ledger',
    actionTab: 'ledger',
  },
  {
    id: 'pdf-reports-local',
    category: 'statements',
    categoryLabel: 'Statements & Reports',
    question: 'How are printable PDF reports generated without sending data to a server?',
    answer:
      'The Reports tab uses jsPDF directly inside your browser to assemble an A4 PDF containing your selected month summary, category breakdowns, cap statuses, active savings recommendations, and largest expenses. Both Download PDF and Print PDF happen entirely in local memory on your device.',
    actionLabel: 'Open Reports Tab',
    actionTab: 'reports',
  },
  {
    id: 'cap-pace-alerts',
    category: 'statements',
    categoryLabel: 'Statements & Reports',
    question: 'How do projected monthly spending-cap alerts work?',
    answer:
      'A lightweight local background check compares your spending so far in the latest statement month against elapsed days in the month to estimate your month-end total for every category with a custom cap. If any category is on pace to exceed its monthly cap, a dismissible banner appears at the top of the workspace so you can adjust before month-end.',
    actionLabel: 'Review Category Caps',
    actionTab: 'overview',
  },
  {
    id: 'family-share-crypto',
    category: 'sharing',
    categoryLabel: 'Family Sharing',
    question: 'How does Family Share guarantee only another Clearledger user can decrypt my file?',
    answer:
      'Each Clearledger installation generates a non-extractable ECDH P-256 device keypair inside IndexedDB. When you share a .clearledger-share.json file, you paste your family member’s public Share ID (plus an optional household passphrase). Clearledger derives a shared secret via ECDH + HKDF-SHA256 and encrypts the file with AES-256-GCM bound exclusively to their Clearledger app instance—anyone else inspecting the file sees only random ciphertext.',
    actionLabel: 'Open Family Share',
    actionTab: 'family',
  },
];

interface FaqViewProps {
  onNavigate: (
    tab:
      | 'overview'
      | 'subscriptions'
      | 'cuts'
      | 'wealth'
      | 'debt'
      | 'planner'
      | 'reports'
      | 'ai'
      | 'ledger'
      | 'family'
      | 'vault'
      | 'faq'
  ) => void;
}

export const FaqView: React.FC<FaqViewProps> = ({ onNavigate }) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<FaqCategory>('all');
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({
    'byok-setup': true,
    'timed-key-hygiene': true,
    'zero-pii-ai': false,
  });

  const filteredFaqs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return FAQ_ITEMS.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (q) {
        const hay = `${item.question} ${item.answer} ${item.categoryLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [search, category]);

  const toggleItem = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Frequently Asked Questions &amp; Setup Guide
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          <span>AI API key hygiene (Gemini, Claude, ChatGPT)</span>
          <span aria-hidden="true">·</span>
          <span>Local AES-256-GCM encryption</span>
          <span aria-hidden="true">·</span>
          <span>PDF reports &amp; encrypted family sharing</span>
        </div>
      </div>

      {/* Search & Category Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search FAQ (e.g., API key, Claude, Cash ISA, PDF, encryption)..."
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>

        <div
          className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full"
          role="group"
          aria-label="Filter FAQ by topic"
        >
          {(
            [
              { id: 'all', label: 'All Topics' },
              { id: 'ai_hygiene', label: 'AI & Key Hygiene' },
              { id: 'privacy', label: 'Privacy & Vault' },
              { id: 'statements', label: 'Statements & PDF' },
              { id: 'sharing', label: 'Family Share' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                category === tab.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Reference: Supported AI Provider Secret Names */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              AI Provider Secret Hygiene Reference
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Add only the provider secret you need in Settings &gt; Secrets or your local .env file, and remove it when finished
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ai')}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
          >
            <span>Open AI Advisor</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="py-3 md:py-0 md:pr-5 space-y-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Google Gemini
            </p>
            <p className="text-xs font-mono text-teal-700 dark:text-teal-400">
              GEMINI_API_KEY
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Model: gemini-4-hydrogen · Default structured financial reasoning
            </p>
          </div>
          <div className="py-3 md:py-0 md:px-5 space-y-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Anthropic Claude
            </p>
            <p className="text-xs font-mono text-teal-700 dark:text-teal-400">
              ANTHROPIC_API_KEY
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Model: claude-sonnet-4-5 · Optional second opinion on your summary
            </p>
          </div>
          <div className="py-3 md:py-0 md:pl-5 space-y-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              OpenAI ChatGPT
            </p>
            <p className="text-xs font-mono text-teal-700 dark:text-teal-400">
              OPENAI_API_KEY
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Model: gpt-4.1-mini · Optional summary advisor via server proxy
            </p>
          </div>
        </div>
      </section>

      {/* Accordion FAQ List */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
        {filteredFaqs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No FAQ entries match "{search}". Try searching for "API", "encryption", or "PDF".
          </div>
        ) : (
          filteredFaqs.map((faq) => {
            const isOpen = Boolean(openIds[faq.id]);
            return (
              <div key={faq.id} className="p-5 sm:px-6">
                <button
                  type="button"
                  onClick={() => toggleItem(faq.id)}
                  aria-expanded={isOpen}
                  className="w-full min-h-[40px] flex items-start justify-between gap-4 text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {faq.categoryLabel}
                    </p>
                    <h3 className="mt-0.5 text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100">
                      {faq.question}
                    </h3>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                  )}
                </button>

                {isOpen && (
                  <div className="mt-3 space-y-3 max-w-3xl">
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {faq.answer}
                    </p>
                    {faq.actionLabel && faq.actionTab && (
                      <button
                        type="button"
                        onClick={() => onNavigate(faq.actionTab!)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                      >
                        <span>{faq.actionLabel}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};
