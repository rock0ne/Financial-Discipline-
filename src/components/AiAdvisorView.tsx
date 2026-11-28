import React, { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Lock,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  AiAssistantSettings,
  AiProviderSetting,
  AiRetentionOption,
  CurrencyCode,
  IsaPlannerSettings,
  SavingsGoal,
} from '../types/finance';
import type { AnalyticsResult } from '../utils/analyticsEngine';
import {
  buildSanitizedAiPacket,
  type AiAdvisorResponse,
} from '../utils/privacySanitizer';
import { buildAdvisorRequestJson } from '../utils/aiOutboundPolicy';
import {
  AI_PROVIDER_LABELS,
  AI_RETENTION_OPTIONS,
  formatRemainingRetention,
  type ProviderAvailabilityMap,
} from '../utils/aiSettings';

interface AiAdvisorViewProps {
  analytics: AnalyticsResult;
  isaSettings: IsaPlannerSettings;
  goals: SavingsGoal[];
  currency: CurrencyCode;
  transactionCount: number;
  aiSettings: AiAssistantSettings;
  providerStatus: ProviderAvailabilityMap | null;
  onUpdateAiProvider: (provider: AiProviderSetting) => void;
  onUpdateAiRetention: (retention: AiRetentionOption) => void;
  onUpdateAiRatiosOnly: (ratiosOnly: boolean) => void;
  onForgetAiSession: () => void;
  onNavigateSettings: () => void;
}

const SUGGESTED_QUESTIONS = [
  'Should I build my 6-month emergency fund first or maximize my Cash ISA and LISA this tax year?',
  'Where is the easiest monthly savings win without hurting my quality of life?',
  'How should I split my monthly surplus between Cash ISA, Lifetime ISA, and Stocks & Shares ISA?',
  'What hidden spending trends or price-hike risks stand out in my 12-month ratios?',
];

export const AiAdvisorView: React.FC<AiAdvisorViewProps> = ({
  analytics,
  isaSettings,
  goals,
  currency,
  transactionCount,
  aiSettings,
  providerStatus,
  onUpdateAiProvider,
  onUpdateAiRetention,
  onUpdateAiRatiosOnly,
  onForgetAiSession,
  onNavigateSettings,
}) => {
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [showInspector, setShowInspector] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<AiAdvisorResponse | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // Live 1s tick when a short retention countdown is active
  useEffect(() => {
    if (aiSettings.provider === 'off' || aiSettings.expiresAt === null) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [aiSettings.provider, aiSettings.expiresAt]);

  // Clear cached advice immediately if provider switches to 'off'
  useEffect(() => {
    if (aiSettings.provider === 'off') {
      setAdvice(null);
      setQuestion('');
    }
  }, [aiSettings.provider]);

  const sanitizedPacket = useMemo(
    () =>
      buildSanitizedAiPacket(
        analytics,
        isaSettings,
        goals,
        currency,
        aiSettings.ratiosOnly
      ),
    [analytics, isaSettings, goals, currency, aiSettings.ratiosOnly]
  );

  const requestJson = useMemo(
    () => buildAdvisorRequestJson(aiSettings.provider, sanitizedPacket, question),
    [aiSettings.provider, sanitizedPacket, question]
  );

  const isOff = aiSettings.provider === 'off';
  const isNativePackage = Capacitor.isNativePlatform() || Boolean(
    (window as Window & { clearledgerDesktop?: { isDesktopApp?: boolean } })
      .clearledgerDesktop?.isDesktopApp
  );
  const activeProviderState =
    aiSettings.provider !== 'off' ? providerStatus?.[aiSettings.provider] ?? null : null;
  const activeProviderLabel = AI_PROVIDER_LABELS[aiSettings.provider];

  const handleRequestAdvice = async () => {
    if (isNativePackage) {
      setError('AI Advisor is unavailable in this private native build; no data was sent.');
      return;
    }
    if (aiSettings.provider === 'off') {
      setError('Turn on an AI provider first (Claude, ChatGPT, or Gemini).');
      return;
    }

    setError(null);
    setSessionNotice(null);
    setLoading(true);
    try {
      const res = await fetch('/api/ai-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestJson,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      setAdvice(data as AiAdvisorResponse);

      if (aiSettings.retention === 'single') {
        setSessionNotice(
          'Single-query mode: consultation completed. Outbound AI access has been switched back to Off.'
        );
        onUpdateAiProvider('off');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not reach the AI Advisor endpoint.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Privacy-First AI Advisor
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Off by default · Controlled in Vault &amp; Settings · Only anonymized local summaries are ever sent
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateSettings}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
          Manage in Vault &amp; Settings
        </button>
      </div>

      {isNativePackage && (
        <div role="status" className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 text-sm">
          AI Advisor is not connected in this private Windows/Android build. Local reports and planning still work; no finance data is sent to an AI provider.
        </div>
      )}

      {/* Synced Provider & Retention Bar (mirrors ReadAloud Settings controls) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label
              htmlFor="advisor-provider-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Provider
            </label>
            <select
              id="advisor-provider-select"
              disabled={isNativePackage}
              value={aiSettings.provider}
              onChange={(e) => {
                const next = e.target.value as AiProviderSetting;
                onUpdateAiProvider(next);
                setError(null);
                setSessionNotice(null);
              }}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="off">Off</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="chatgpt">ChatGPT (OpenAI)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label
              htmlFor="advisor-retention-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Keep AI enabled
            </label>
            <select
              id="advisor-retention-select"
              disabled={isOff}
              value={aiSettings.retention}
              onChange={(e) => onUpdateAiRetention(e.target.value as AiRetentionOption)}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-50"
            >
              {AI_RETENTION_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4 flex items-center justify-between md:justify-end gap-3">
            {!isOff ? (
              <>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1 font-mono-num text-teal-700 dark:text-teal-400 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    {formatRemainingRetention(aiSettings.expiresAt, nowTick)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onForgetAiSession();
                    setAdvice(null);
                    setQuestion('');
                    setError(null);
                    setSessionNotice(
                      'AI assistant switched Off and cached responses cleared from memory.'
                    );
                  }}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Forget &amp; Turn Off
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                No external AI provider active
              </span>
            )}
          </div>
        </div>
      </section>

      {sessionNotice && (
        <div
          role="status"
          className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300"
        >
          {sessionNotice}
        </div>
      )}

      {/* Explain the boundary of the generated summary and the user-authored question. */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Local Privacy Firewall Active
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono-num text-slate-800 dark:text-slate-200">
                  {transactionCount}
                </span>{' '}
                ledger rows are not added to the AI summary. Your optional question is
                also sent to the selected provider, so do not include names, account
                numbers, merchant details, or transaction text.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aiSettings.ratiosOnly}
                onChange={(e) => onUpdateAiRatiosOnly(e.target.checked)}
                className="w-4 h-4 rounded accent-teal-700"
              />
              <span>Mask exact amounts (ratios &amp; bands only)</span>
            </label>

            <button
              type="button"
              onClick={() => setShowInspector((v) => !v)}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{showInspector ? 'Hide Outbound Payload' : 'Inspect Outbound JSON'}</span>
              {showInspector ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {showInspector && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>
                Exact JSON request to the local proxy, including your question ({new Blob([requestJson]).size} bytes)
              </span>
              <span className="font-mono-num">
                {aiSettings.ratiosOnly ? 'Ratios & Bands Only' : 'Rounded Category Totals'}
              </span>
            </div>
            <pre className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-72 leading-relaxed">
              {requestJson}
            </pre>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              The proxy adds instructions before forwarding the summary and question to the selected AI provider.
            </p>
          </div>
        )}
      </section>

      {/* Ask AI Prompt or Calm Off State */}
      {isOff ? (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 text-center space-y-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            AI Financial Assistant is turned Off
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
            {isNativePackage
              ? 'This private native build keeps the AI Advisor disconnected. Your local finance tools remain available.'
              : 'Clearledger runs 100% locally without sending anything off your device. Select Claude, ChatGPT, or Gemini in the Provider dropdown above—or in Vault & Settings—whenever you want AI guidance on your anonymized summary.'}
          </p>
        </section>
      ) : (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Ask {activeProviderLabel}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Ask a specific question or request a full review of your locally calculated numbers
              </p>
            </div>
            {activeProviderState && !activeProviderState.available && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Configure {activeProviderState.envVar} in Settings &gt; Secrets to activate
              </span>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRequestAdvice();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              placeholder="Optional question (e.g., Should I prioritize my Lifetime ISA or emergency buffer?)"
              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={loading || analytics.monthCount === 0 || isNativePackage}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <span>Analyzing Summary…</span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Ask Advisor</span>
                </>
              )}
            </button>
          </form>

          <p className="text-xs text-amber-800 dark:text-amber-300">
            Review the outbound JSON before asking. Your typed question is sent with the summary;
            leave out personal and bank details.
          </p>

          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading || analytics.monthCount === 0 || isNativePackage}
                onClick={() => {
                  setQuestion(q);
                  setShowInspector(true);
                }}
                className="min-h-[36px] text-left px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-xs text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          {error && (
            <div
              role="alert"
              className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-900 dark:text-red-200"
            >
              {error}
            </div>
          )}
        </section>
      )}

      {/* AI Advisor Structured Output */}
      {loading && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="h-4 w-48 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-3 w-full bg-slate-100 dark:bg-slate-800/70 rounded" />
          <div className="h-3 w-5/6 bg-slate-100 dark:bg-slate-800/70 rounded" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              />
            ))}
          </div>
        </div>
      )}

      {!loading && advice && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                Assessment of Your Anonymized Summary
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {advice.modelUsed} · Generated summary shared
              </span>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {advice.executiveSummary}
            </p>

            {advice.directAnswer && advice.directAnswer.trim().length > 0 && (
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-teal-800 dark:text-teal-300 mb-1.5">
                  Answer to Your Question
                </h3>
                <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                  {advice.directAnswer}
                </p>
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">
              Top 3 High-Impact Actions
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
              {advice.priorityActions.map((act, idx) => (
                <div
                  key={`${act.title}-${idx}`}
                  className="py-4 md:py-0 md:px-5 first:pt-0 md:first:pl-0 last:pb-0 md:last:pr-0 space-y-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      0{idx + 1}. {act.category}
                    </span>
                    <span className="text-xs font-mono-num font-semibold text-teal-700 dark:text-teal-400 shrink-0">
                      {act.estimatedImpact}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {act.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {act.steps}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Cash ISA, LISA &amp; Allocation Guidance
              </h2>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {advice.isaAllocationGuidance}
              </p>
            </section>

            <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-3">
                Blind Spots &amp; Trends to Watch
              </h2>
              <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {advice.blindSpotsAndRisks.map((risk, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono-num text-amber-700 dark:text-amber-400 font-semibold shrink-0">
                      0{i + 1}.
                    </span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
