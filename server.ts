import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const GEMINI_MODEL = 'gemini-4-hydrogen';
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const OPENAI_MODEL = 'gpt-4.1-mini';

const SYSTEM_INSTRUCTION =
  'You are a calm, objective, mathematically precise personal finance coach specializing in UK and household budgeting, Cash ISAs, Lifetime ISAs (25% bonus up to £4,000/yr), Stocks & Shares ISAs, and emergency buffers. Base all advice strictly on the anonymized summary numbers provided. Keep prose concise, practical, and free of hype or disclaimers longer than one clause. Never ask for bank logins, account numbers, or raw statements.';

function isKeyConfigured(val: string | undefined, placeholder: string): boolean {
  return Boolean(val && val.trim().length > 0 && val.trim() !== placeholder);
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!isKeyConfigured(apiKey, 'MY_GEMINI_API_KEY')) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey!,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Strict allowlist validation to guarantee zero raw statements or PII are processed by the API route
function validateSanitizedPacket(
  raw: unknown
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request must include a sanitized financial summary object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 'clearledger-zero-pii-v1') {
    return {
      ok: false,
      error: 'Unsupported summary schema. Only zero-PII local summaries are accepted.',
    };
  }

  // Explicitly reject any raw transaction or PII keys
  const forbiddenKeys = [
    'transactions',
    'rawCsv',
    'accountNumber',
    'sortCode',
    'iban',
    'merchants',
    'descriptions',
  ];
  for (const key of forbiddenKeys) {
    if (key in obj) {
      return { ok: false, error: `Privacy guard rejected disallowed field: ${key}` };
    }
  }

  const allowedKeys = new Set([
    'schemaVersion',
    'privacyMode',
    'currency',
    'monthsAnalyzed',
    'incomeBand',
    'ratios',
    'monthlyAveragesRounded',
    'recurringSignals',
    'categoryBreakdown',
    'isaStrategy',
    'goals',
  ]);

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowedKeys.has(k)) {
      clean[k] = v;
    }
  }

  if (!Array.isArray(clean.categoryBreakdown) || clean.categoryBreakdown.length > 25) {
    return { ok: false, error: 'Invalid category breakdown array.' };
  }

  return { ok: true, data: clean };
}

function buildAdvisorPrompt(summaryData: Record<string, unknown>, userQuestion: string): string {
  return [
    'Below is a strictly anonymized, locally computed household financial summary (zero raw bank transactions, zero merchant names, zero personal identifiers).',
    '',
    JSON.stringify(summaryData, null, 2),
    '',
    userQuestion
      ? `The user also asked this specific question: "${userQuestion}". Make sure to answer it thoroughly in the directAnswer field using their summary metrics.`
      : 'No custom question was provided. Provide a clear, high-impact savings and ISA strategy review.',
  ].join('\n');
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

const JSON_SHAPE_INSTRUCTION =
  'Return strictly valid JSON with keys: executiveSummary (string), directAnswer (string), priorityActions (array of 3 objects with title, category, estimatedImpact, steps), isaAllocationGuidance (string), blindSpotsAndRisks (array of 2-3 strings). No markdown fences.';

async function callClaudeAdvisor(prompt: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!isKeyConfigured(apiKey, 'MY_ANTHROPIC_API_KEY')) {
    throw new Error(
      'Claude is not configured on this server. Add ANTHROPIC_API_KEY in Settings > Secrets to use Claude.'
    );
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1400,
      system: `${SYSTEM_INSTRUCTION} ${JSON_SHAPE_INSTRUCTION}`,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const status = res.status;
    throw new Error(`Claude API request failed (${status}). Check ANTHROPIC_API_KEY in Settings > Secrets.`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textBlock = data.content?.find((c) => c.type === 'text')?.text ?? '';
  if (!textBlock.trim()) {
    throw new Error('Claude returned an empty response.');
  }
  return {
    ...extractJsonObject(textBlock),
    modelUsed: CLAUDE_MODEL,
  };
}

async function callOpenAiAdvisor(prompt: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!isKeyConfigured(apiKey, 'MY_OPENAI_API_KEY')) {
    throw new Error(
      'ChatGPT is not configured on this server. Add OPENAI_API_KEY in Settings > Secrets to use ChatGPT.'
    );
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey!}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM_INSTRUCTION} ${JSON_SHAPE_INSTRUCTION}` },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const status = res.status;
    throw new Error(`OpenAI API request failed (${status}). Check OPENAI_API_KEY in Settings > Secrets.`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error('ChatGPT returned an empty response.');
  }
  return {
    ...extractJsonObject(content),
    modelUsed: OPENAI_MODEL,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  // Expose ONLY boolean availability of server-side configured providers (never any key material)
  app.get('/api/ai-providers', (_req, res) => {
    res.json({
      providers: {
        gemini: {
          available: isKeyConfigured(process.env.GEMINI_API_KEY, 'MY_GEMINI_API_KEY'),
          model: GEMINI_MODEL,
          envVar: 'GEMINI_API_KEY',
        },
        claude: {
          available: isKeyConfigured(process.env.ANTHROPIC_API_KEY, 'MY_ANTHROPIC_API_KEY'),
          model: CLAUDE_MODEL,
          envVar: 'ANTHROPIC_API_KEY',
        },
        chatgpt: {
          available: isKeyConfigured(process.env.OPENAI_API_KEY, 'MY_OPENAI_API_KEY'),
          model: OPENAI_MODEL,
          envVar: 'OPENAI_API_KEY',
        },
      },
    });
  });

  app.post('/api/ai-advisor', async (req, res) => {
    try {
      const { summary, question, provider } = req.body ?? {};
      const selectedProvider =
        provider === 'claude' || provider === 'chatgpt' ? provider : 'gemini';

      const validation = validateSanitizedPacket(summary);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const userQuestion =
        typeof question === 'string' ? question.trim().slice(0, 500) : '';
      const prompt = buildAdvisorPrompt(validation.data, userQuestion);

      if (selectedProvider === 'claude') {
        const result = await callClaudeAdvisor(prompt);
        res.json(result);
        return;
      }

      if (selectedProvider === 'chatgpt') {
        const result = await callOpenAiAdvisor(prompt);
        res.json(result);
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'Gemini AI Advisor is not configured yet. Set GEMINI_API_KEY in Settings > Secrets to enable AI guidance.',
        });
        return;
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: {
                type: Type.STRING,
                description:
                  '2-3 sentence diagnosis of current essential vs non-essential balance and savings opportunity.',
              },
              directAnswer: {
                type: Type.STRING,
                description:
                  'Direct, tailored answer to the user question if one was asked, otherwise empty string.',
              },
              priorityActions: {
                type: Type.ARRAY,
                description: 'Exactly 3 highest-leverage concrete actions ranked by impact.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    category: { type: Type.STRING },
                    estimatedImpact: { type: Type.STRING },
                    steps: { type: Type.STRING },
                  },
                  required: ['title', 'category', 'estimatedImpact', 'steps'],
                },
              },
              isaAllocationGuidance: {
                type: Type.STRING,
                description:
                  'Specific advice on balancing Emergency Buffer, Cash ISA, Lifetime ISA, and Stocks & Shares ISA given their tax band and horizon.',
              },
              blindSpotsAndRisks: {
                type: Type.ARRAY,
                description:
                  '2-3 concise risks or blind spots spotted in the trends (e.g., rising 3-month trends, price hikes, ISA cap pacing).',
                items: { type: Type.STRING },
              },
            },
            required: [
              'executiveSummary',
              'directAnswer',
              'priorityActions',
              'isaAllocationGuidance',
              'blindSpotsAndRisks',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'The AI model returned an empty response. Please retry.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({
        ...parsed,
        modelUsed: GEMINI_MODEL,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unexpected server error calling AI Advisor.';
      if (message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
        res.status(403).json({
          error: 'Invalid or unauthorized API key. Please check Settings > Secrets.',
        });
        return;
      }
      if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
        res.status(429).json({
          error: 'API rate limit reached. Please wait a moment and try again.',
        });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // Vite 8 injects /@vite/client which attempts a WebSocket connection on port 24678
    // even when hmr/ws are disabled in middlewareMode. Serve a WebSocket-free shim with
    // full style-injection and hot-context compatibility so dev preview stays error-free.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const data = {};
  return {
    data,
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url.startsWith('.') && !url.startsWith('/')) return url;
  const [pathname, search] = url.split('?');
  return pathname + '?' + (search ? search + '&' : '') + queryToInject;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Clearledger server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Clearledger server:', err);
  process.exit(1);
});
