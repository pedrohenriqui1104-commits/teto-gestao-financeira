import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

interface FinancialContextPayload {
  periodLabel: string;
  referenceDate: string;
  remainingDays: number;
  isPeriodClosed: boolean;
  isDeficit: boolean;
  availableToSpendCents: number;
  dailyCeilingCents: number;
  plannedFreeCeilingCents: number;
  periodRevenuesCents: number;
  periodPendingRevenuesCents: number;
  periodFixedExpensesCents: number;
  periodVariableExpensesCents: number;
  currentCashBalanceCents: number;
  reserveBalanceCents: number;
  topCategories: Array<{ name: string; totalCents: number }>;
  availableCategories: Array<{ id: string; name: string; type: string }>;
}

interface AssistantHistoryItem {
  sender: 'user' | 'ai';
  text: string;
}

function getConfiguredGeminiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY?.trim();
  if (!raw || raw === 'MY_GEMINI_API_KEY') return null;
  return raw;
}

function formatBRL(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((safe === 0 ? 0 : safe) / 100);
}

function truncateCentsPerDay(availableCents: number, remainingDays: number): number {
  if (!Number.isFinite(availableCents) || !Number.isFinite(remainingDays)) return 0;
  if (availableCents <= 0 || remainingDays <= 0) return 0;
  return Math.trunc(availableCents / remainingDays);
}

function sanitizeFinancialContext(raw: unknown): FinancialContextPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<FinancialContextPayload>;

  const num = (val: unknown, fallback = 0) =>
    typeof val === 'number' && Number.isFinite(val) ? Math.trunc(val) : fallback;

  const topCategories = Array.isArray(c.topCategories)
    ? c.topCategories
        .slice(0, 6)
        .filter(
          (item): item is { name: string; totalCents: number } =>
            Boolean(item && typeof item.name === 'string' && typeof item.totalCents === 'number')
        )
        .map((item) => ({ name: item.name.slice(0, 40), totalCents: num(item.totalCents) }))
    : [];

  const availableCategories = Array.isArray(c.availableCategories)
    ? c.availableCategories
        .slice(0, 20)
        .filter(
          (item): item is { id: string; name: string; type: string } =>
            Boolean(
              item &&
                typeof item.id === 'string' &&
                typeof item.name === 'string' &&
                typeof item.type === 'string'
            )
        )
        .map((item) => ({
          id: item.id.slice(0, 40),
          name: item.name.slice(0, 40),
          type: item.type.slice(0, 16),
        }))
    : [];

  return {
    periodLabel: typeof c.periodLabel === 'string' ? c.periodLabel.slice(0, 60) : 'Ciclo atual',
    referenceDate: typeof c.referenceDate === 'string' ? c.referenceDate.slice(0, 10) : '',
    remainingDays: Math.max(0, num(c.remainingDays)),
    isPeriodClosed: Boolean(c.isPeriodClosed),
    isDeficit: Boolean(c.isDeficit),
    availableToSpendCents: num(c.availableToSpendCents),
    dailyCeilingCents: Math.max(0, num(c.dailyCeilingCents)),
    plannedFreeCeilingCents: num(c.plannedFreeCeilingCents),
    periodRevenuesCents: Math.max(0, num(c.periodRevenuesCents)),
    periodPendingRevenuesCents: Math.max(0, num(c.periodPendingRevenuesCents)),
    periodFixedExpensesCents: Math.max(0, num(c.periodFixedExpensesCents)),
    periodVariableExpensesCents: Math.max(0, num(c.periodVariableExpensesCents)),
    currentCashBalanceCents: num(c.currentCashBalanceCents),
    reserveBalanceCents: Math.max(0, num(c.reserveBalanceCents)),
    topCategories,
    availableCategories,
  };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({ error: 'Corpo da requisição JSON inválido.' });
        return;
      }
      next(err);
    }
  );

  app.get('/api/ai/status', (_req, res) => {
    const geminiConfigured = Boolean(getConfiguredGeminiKey());
    res.json({
      geminiConfigured,
      mode: geminiConfigured ? 'gemini' : 'local-simulator',
    });
  });

  app.post('/api/ai/assistant', async (req, res) => {
    const apiKey = getConfiguredGeminiKey();
    if (!apiKey) {
      res.status(503).json({
        error:
          'Integração Gemini não configurada neste servidor (GEMINI_API_KEY ausente). Use o modo Simulador Local.',
        geminiConfigured: false,
      });
      return;
    }

    const body = req.body as {
      prompt?: unknown;
      history?: unknown;
      financialContext?: unknown;
    };

    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 600) {
      res.status(400).json({ error: 'Informe uma pergunta válida (até 600 caracteres).' });
      return;
    }

    const ctx = sanitizeFinancialContext(body?.financialContext);
    if (!ctx) {
      res.status(400).json({ error: 'Contexto financeiro inválido.' });
      return;
    }

    const history: AssistantHistoryItem[] = Array.isArray(body?.history)
      ? body.history
          .slice(-6)
          .filter(
            (h): h is AssistantHistoryItem =>
              Boolean(
                h &&
                  typeof h === 'object' &&
                  (h.sender === 'user' || h.sender === 'ai') &&
                  typeof h.text === 'string'
              )
          )
          .map((h) => ({ sender: h.sender, text: h.text.slice(0, 400) }))
      : [];

    const systemInstruction = [
      'Você é o Assistente Financeiro do aplicativo Teto Finance, respondendo em português brasileiro.',
      'Regras estritas:',
      '1. Utilize EXCLUSIVAMENTE os números reais fornecidos no contexto financeiro. NUNCA invente valores, transações ou saldos.',
      '2. Se não houver movimentações suficientes ou dados para responder algo específico, explique claramente o que falta sem inventar estimativas.',
      '3. Simule gastos ou aportes sem registrar nada automaticamente.',
      '4. Quando o usuário simular um gasto de valor específico, preencha simulationAmountCents com o valor inteiro em centavos (positivo) e simulationKind = "despesa" com uma descrição curta em suggestedDescription e categoria correspondente em suggestedCategoryId.',
      '5. Quando o usuário simular guardar/aportar na reserva um valor específico, preencha simulationAmountCents com o valor em centavos e simulationKind = "reserva".',
      '6. Se a pergunta for apenas informativa (sem simulação de valor), deixe simulationAmountCents como 0 e simulationKind = "nenhum".',
      '7. Seja claro, objetivo (máximo 3 frases curtas) e mencione valores formatados em R$.',
    ].join('\n');

    const contextSummary = {
      ciclo: ctx.periodLabel,
      dataReferencia: ctx.referenceDate,
      diasRestantesNoCiclo: ctx.remainingDays,
      cicloEncerrado: ctx.isPeriodClosed,
      emDeficit: ctx.isDeficit,
      tetoLivreDisponivel: formatBRL(ctx.availableToSpendCents),
      tetoDiarioAtual: formatBRL(ctx.dailyCeilingCents),
      tetoLivrePlanejado: formatBRL(ctx.plannedFreeCeilingCents),
      receitasConfirmadas: formatBRL(ctx.periodRevenuesCents),
      receitasPendentes: formatBRL(ctx.periodPendingRevenuesCents),
      gastosFixos: formatBRL(ctx.periodFixedExpensesCents),
      gastosLivresVariaveis: formatBRL(ctx.periodVariableExpensesCents),
      saldoEmCaixaConfirmado: formatBRL(ctx.currentCashBalanceCents),
      reservaAcumulada: formatBRL(ctx.reserveBalanceCents),
      maioresCategoriasDespesa: ctx.topCategories.map((c) => ({
        categoria: c.name,
        total: formatBRL(c.totalCents),
      })),
      categoriasDisponiveis: ctx.availableCategories.filter(
        (c) => c.type === 'despesa' || c.type === 'ambos'
      ),
    };

    const contents = [
      `Contexto financeiro real da conta ativa (JSON):\n${JSON.stringify(contextSummary)}`,
      history.length > 0
        ? `Histórico recente:\n${history.map((m) => `${m.sender === 'user' ? 'Usuário' : 'Teto IA'}: ${m.text}`).join('\n')}`
        : '',
      `Pergunta atual do usuário: ${prompt}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 12000,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const candidateModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
      let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
      let lastModelError: unknown = null;

      for (const modelName of candidateModels) {
        try {
          response = await ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  replyText: {
                    type: Type.STRING,
                    description:
                      'Resposta direta e concisa em português brasileiro baseada apenas no contexto.',
                  },
                  simulationKind: {
                    type: Type.STRING,
                    description: 'Valores possíveis: "nenhum", "despesa", "reserva".',
                  },
                  simulationAmountCents: {
                    type: Type.INTEGER,
                    description:
                      'Valor simulado em centavos (ex: 5500 para R$ 55,00), ou 0 se não houver simulação.',
                  },
                  suggestedDescription: {
                    type: Type.STRING,
                    description:
                      'Descrição curta da despesa sugerida caso simulationKind seja "despesa".',
                  },
                  suggestedCategoryId: {
                    type: Type.STRING,
                    description: 'ID da categoria mais adequada dentre categoriasDisponiveis.',
                  },
                },
                required: ['replyText', 'simulationKind', 'simulationAmountCents'],
              },
            },
          });
          break;
        } catch (err) {
          lastModelError = err;
          const errStr = err instanceof Error ? `${err.name} ${err.message}` : String(err);
          const isTransient =
            /500|502|503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL|high demand|overloaded|timeout|timed out|abort|ECONNRESET|fetch failed/i.test(
              errStr
            );
          if (!isTransient) {
            throw err;
          }
        }
      }

      if (!response) {
        throw lastModelError ?? new Error('Modelo Gemini indisponível temporariamente.');
      }

      const rawText = (response.text ?? '').trim();
      const cleanJsonText = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsed = JSON.parse(cleanJsonText) as {
        replyText?: string;
        simulationKind?: string;
        simulationAmountCents?: number;
        suggestedDescription?: string;
        suggestedCategoryId?: string;
      };

      const replyText =
        typeof parsed.replyText === 'string' && parsed.replyText.trim()
          ? parsed.replyText.trim()
          : 'Não consegui interpretar os dados para responder agora.';

      const simCents =
        typeof parsed.simulationAmountCents === 'number' &&
        Number.isFinite(parsed.simulationAmountCents) &&
        parsed.simulationAmountCents > 0
          ? Math.trunc(parsed.simulationAmountCents)
          : 0;

      const kind =
        parsed.simulationKind === 'despesa' || parsed.simulationKind === 'reserva'
          ? parsed.simulationKind
          : 'nenhum';

      if (simCents > 0 && kind !== 'nenhum') {
        const projectedFreeCents = ctx.availableToSpendCents - simCents;
        const projectedDailyCents =
          ctx.remainingDays > 0 ? truncateCentsPerDay(projectedFreeCents, ctx.remainingDays) : 0;
        const daysImpact =
          ctx.dailyCeilingCents > 0
            ? (simCents / ctx.dailyCeilingCents).toFixed(1).replace('.', ',')
            : '—';
        const impactBarPercent =
          ctx.availableToSpendCents > 0
            ? Math.min(100, Math.max(8, Math.round((simCents / ctx.availableToSpendCents) * 100)))
            : 100;

        const validCat = ctx.availableCategories.find((c) => c.id === parsed.suggestedCategoryId);

        res.json({
          mode: 'gemini',
          analysis: {
            replyText,
            decisionTitle:
              kind === 'reserva'
                ? `Simulação de Aporte (${formatBRL(simCents)})`
                : `Impacto (${formatBRL(simCents)})`,
            amountCents: simCents,
            daysImpactText: daysImpact === '—' ? 'Sem teto ativo' : `-${daysImpact} dias de teto`,
            impactBarPercent,
            projectedFreeCents,
            projectedDailyCents,
            decisionSummary:
              projectedFreeCents >= 0
                ? `Se confirmar agora, seu saldo livre ficará em ${formatBRL(
                    projectedFreeCents
                  )} (${formatBRL(projectedDailyCents)}/dia).`
                : `Atenção: esse valor ultrapassa seu teto livre atual em ${formatBRL(
                    Math.abs(projectedFreeCents)
                  )}, zerando o teto diário do ciclo.`,
            suggestedDescription:
              kind === 'despesa'
                ? parsed.suggestedDescription?.trim() || 'Gasto Simulado via Teto IA'
                : undefined,
            suggestedCategoryId: kind === 'despesa' ? validCat?.id : undefined,
          },
        });
        return;
      }

      res.json({
        mode: 'gemini',
        analysis: {
          replyText,
        },
      });
    } catch (error) {
      console.error('Erro na chamada Gemini:', error);
      const rawMsg = error instanceof Error ? error.message : '';
      const isOverloaded = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(
        rawMsg
      );
      res.status(502).json({
        error: isOverloaded
          ? 'O serviço Gemini está temporariamente com alta demanda. Tente novamente em instantes ou use o Simulador Local.'
          : 'Não foi possível concluir a consulta no servidor Gemini agora.',
        retryable: true,
      });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota da API não encontrada.' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Rota da API não encontrada.' });
        return;
      }
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TETO server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer();
