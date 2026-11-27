import type {
  AiAssistantSettings,
  AiProviderId,
  AiProviderSetting,
  AiRetentionOption,
} from '../types/finance';

export const AI_SETTINGS_STORAGE_KEY = 'clearledger_ai_settings_v1';

export const AI_RETENTION_OPTIONS: Array<{
  id: AiRetentionOption;
  label: string;
  durationMs: number | null; // null = single query only
}> = [
  { id: 'single', label: 'Only for a single query', durationMs: null },
  { id: '15m', label: 'For 15 minutes', durationMs: 15 * 60 * 1000 },
  { id: '1h', label: 'For 1 hour', durationMs: 60 * 60 * 1000 },
  { id: '7d', label: 'For 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'For 30 days', durationMs: 30 * 24 * 60 * 60 * 1000 },
];

export const AI_PROVIDER_LABELS: Record<AiProviderSetting, string> = {
  off: 'Off',
  claude: 'Claude (Anthropic)',
  chatgpt: 'ChatGPT (OpenAI)',
  gemini: 'Gemini (Google)',
};

export interface ProviderAvailability {
  available: boolean;
  model: string;
  envVar: string;
}

export type ProviderAvailabilityMap = Record<AiProviderId, ProviderAvailability>;

export const DEFAULT_AI_SETTINGS: AiAssistantSettings = {
  provider: 'off',
  retention: '30d',
  expiresAt: null,
  ratiosOnly: false,
};

export function computeExpiryTimestamp(
  provider: AiProviderSetting,
  retention: AiRetentionOption,
  now = Date.now()
): number | null {
  if (provider === 'off') return null;
  const opt = AI_RETENTION_OPTIONS.find((o) => o.id === retention);
  if (!opt || opt.durationMs === null) return null;
  return now + opt.durationMs;
}

export function loadAiSettings(): AiAssistantSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiAssistantSettings>;

    const provider: AiProviderSetting =
      parsed.provider === 'claude' ||
      parsed.provider === 'chatgpt' ||
      parsed.provider === 'gemini'
        ? parsed.provider
        : 'off';

    const retention: AiRetentionOption =
      parsed.retention === 'single' ||
      parsed.retention === '15m' ||
      parsed.retention === '1h' ||
      parsed.retention === '7d' ||
      parsed.retention === '30d'
        ? parsed.retention
        : '30d';

    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null;

    // Auto-disable immediately if a previously saved window has expired
    if (provider !== 'off' && expiresAt !== null && expiresAt <= Date.now()) {
      return {
        provider: 'off',
        retention,
        expiresAt: null,
        ratiosOnly: Boolean(parsed.ratiosOnly),
      };
    }

    return {
      provider,
      retention,
      expiresAt: provider === 'off' ? null : expiresAt,
      ratiosOnly: Boolean(parsed.ratiosOnly),
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAiSettings(settings: AiAssistantSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage quota errors
  }
}

export function formatRemainingRetention(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt === null) return 'Single query only';
  const diffMs = Math.max(0, expiresAt - now);
  if (diffMs === 0) return 'Expired';
  const totalSec = Math.ceil(diffMs / 1000);
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} remaining`;
  }
  const hours = Math.ceil(totalSec / 3600);
  if (hours <= 48) {
    return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
  }
  const days = Math.ceil(hours / 24);
  const dateLabel = new Date(expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  return `${days} days remaining (until ${dateLabel})`;
}
