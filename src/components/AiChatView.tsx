import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { TETO_LOGO_SRC } from '../assets/tetoLogo';
import {
  analyzeAssistantPrompt,
  calculateCategoryBreakdown,
  calculateReserveBalanceCents,
} from '../domain/ceilingEngine';
import { centsToBRL } from '../domain/formatters';
import type {
  AssistantAnalysis,
  DailyCeilingResult,
  Transaction,
  WorkspaceState,
} from '../domain/types';
import type { QuickRecordDraft } from './QuickRecordView';
import type { AppView, ToastNotice } from './StitchShell';

interface AiChatViewProps {
  state: WorkspaceState;
  ceiling: DailyCeilingResult;
  periodLabel: string;
  periodTransactions: Transaction[];
  referenceDate: string;
  onNavigate: (view: AppView) => void;
  onRegisterSuggestedExpense: (draft: QuickRecordDraft) => void;
  onNotifyToast: (msg: string, tone?: ToastNotice['tone']) => void;
  toasts: ToastNotice[];
}

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time: string;
  analysis?: AssistantAnalysis;
  isError?: boolean;
  retryPrompt?: string;
}

type AiBackendMode = 'checking' | 'gemini' | 'local-simulator';

function nowTimeHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AiChatView({
  state,
  ceiling,
  periodLabel,
  periodTransactions,
  referenceDate,
  onNavigate,
  onRegisterSuggestedExpense,
  onNotifyToast,
  toasts,
}: AiChatViewProps) {
  const firstName = state.profile.name.trim().split(' ')[0] || 'Usuário';
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [aiMode, setAiMode] = useState<AiBackendMode>('checking');
  const [isSending, setIsSending] = useState(false);
  const [inputText, setInputText] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const activeCount = periodTransactions.filter(
      (tx) => tx.status !== 'cancelado' && !tx.isReversal
    ).length;

    const welcomeText =
      activeCount === 0
        ? `Olá, ${firstName}! Sua conta está com o ciclo atual zerado (teto livre ${centsToBRL(
            ceiling.availableToSpendCents
          )}). Você pode simular um gasto (ex: "Posso gastar R$ 55?") ou perguntar como montar seu orçamento.`
        : `Olá, ${firstName}! Analisei seu ciclo atual (${periodLabel}): seu teto livre disponível é ${centsToBRL(
            ceiling.availableToSpendCents
          )} (${centsToBRL(
            ceiling.dailyCeilingCents
          )}/dia). Pergunte sobre gastos, reserva ou simule uma compra sem registrar automaticamente.`;

    return [
      {
        id: 'welcome',
        sender: 'ai',
        time: 'Agora',
        text: welcomeText,
      },
    ];
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { geminiConfigured?: boolean } | null) => {
        if (cancelled) return;
        setAiMode(data?.geminiConfigured ? 'gemini' : 'local-simulator');
      })
      .catch(() => {
        if (!cancelled) {
          setAiMode('local-simulator');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isSending]);

  const sanitizedContext = useMemo(() => {
    const reserveBalanceCents = calculateReserveBalanceCents(state.reserveMovements);
    const topCategories = calculateCategoryBreakdown(
      periodTransactions,
      state.categories,
      'despesa'
    )
      .slice(0, 6)
      .map((cat) => ({ name: cat.categoryName, totalCents: cat.totalCents }));

    return {
      periodLabel,
      referenceDate,
      remainingDays: ceiling.remainingDays,
      isPeriodClosed: ceiling.isPeriodClosed,
      isDeficit: ceiling.isDeficit,
      availableToSpendCents: ceiling.availableToSpendCents,
      dailyCeilingCents: ceiling.dailyCeilingCents,
      plannedFreeCeilingCents: ceiling.plannedFreeCeilingCents,
      periodRevenuesCents: ceiling.periodRevenuesCents,
      periodPendingRevenuesCents: ceiling.periodPendingRevenuesCents,
      periodFixedExpensesCents: ceiling.periodFixedExpensesCents,
      periodVariableExpensesCents: ceiling.periodVariableExpensesCents,
      currentCashBalanceCents: ceiling.currentCashBalanceCents,
      reserveBalanceCents,
      topCategories,
      availableCategories: state.categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
      })),
    };
  }, [ceiling, periodLabel, periodTransactions, referenceDate, state.categories, state.reserveMovements]);

  const sendPrompt = async (rawPrompt: string) => {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isSending) return;

    const time = nowTimeHHMM();
    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      time,
      text: trimmed,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInputText('');

    if (aiMode === 'gemini') {
      setIsSending(true);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 28000);
      try {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            prompt: trimmed,
            history: nextHistory.slice(-6).map((m) => ({ sender: m.sender, text: m.text })),
            financialContext: sanitizedContext,
          }),
        });
        window.clearTimeout(timeoutId);

        const payload = (await res.json()) as {
          error?: string;
          geminiConfigured?: boolean;
          analysis?: AssistantAnalysis;
        };

        if (!res.ok || !payload.analysis) {
          if (res.status === 503 && payload.geminiConfigured === false) {
            setAiMode('local-simulator');
            const fallbackAnalysis = analyzeAssistantPrompt(trimmed, ceiling, state, referenceDate);
            setMessages((prev) => [
              ...prev,
              {
                id: `ai_${Date.now() + 1}`,
                sender: 'ai',
                time: nowTimeHHMM(),
                text: fallbackAnalysis.replyText,
                analysis: fallbackAnalysis,
              },
            ]);
            return;
          }

          setMessages((prev) => [
            ...prev,
            {
              id: `ai_err_${Date.now() + 1}`,
              sender: 'ai',
              time: nowTimeHHMM(),
              text:
                payload.error ??
                'Não foi possível obter resposta do servidor Gemini neste momento.',
              isError: true,
              retryPrompt: trimmed,
            },
          ]);
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `ai_${Date.now() + 1}`,
            sender: 'ai',
            time: nowTimeHHMM(),
            text: payload.analysis!.replyText,
            analysis: payload.analysis,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `ai_err_${Date.now() + 1}`,
            sender: 'ai',
            time: nowTimeHHMM(),
            text: 'Falha de conexão com a camada de IA no servidor. Tente novamente ou use o Simulador Local.',
            isError: true,
            retryPrompt: trimmed,
          },
        ]);
      } finally {
        window.clearTimeout(timeoutId);
        setIsSending(false);
      }
      return;
    }

    const localAnalysis = analyzeAssistantPrompt(trimmed, ceiling, state, referenceDate);
    setMessages((prev) => [
      ...prev,
      {
        id: `ai_${Date.now() + 1}`,
        sender: 'ai',
        time: nowTimeHHMM(),
        text: localAnalysis.replyText,
        analysis: localAnalysis,
      },
    ]);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendPrompt(inputText);
  };

  const isGeminiActive = aiMode === 'gemini';

  return (
    <div className="min-h-screen bg-[#0B0C10] text-dark-on-surface font-body antialiased selection:bg-primary selection:text-on-primary">
      <div className="w-full max-w-[420px] md:max-w-[780px] lg:max-w-[920px] mx-auto min-h-screen flex flex-col justify-between border-x border-dark-outline/40 shadow-2xl relative bg-dark-surface">
        {/* Top Floating Toasts */}
        {toasts.length > 0 && (
          <div
            aria-live="polite"
            className="fixed top-4 left-1/2 -translate-x-1/2 max-w-[390px] w-[90%] z-50 space-y-2 pointer-events-none"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-DEFAULT bg-dark-surface-variant border border-primary/50 text-dark-on-surface text-xs font-medium shadow-xl flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-success text-base">check_circle</span>
                <span>{t.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Top Navigation Header */}
        <header className="px-5 md:px-7 pt-5 pb-4 flex items-center justify-between gap-3 border-b border-dark-outline/50 sticky top-0 bg-dark-surface/95 z-20 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              aria-label="Voltar ao painel"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-dark-surface-variant text-dark-on-surface-variant hover:text-dark-on-surface border border-dark-outline transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </button>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white shadow-md shadow-primary/20">
                  <span className="material-symbols-outlined text-lg">smart_toy</span>
                </div>
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-dark-surface ${
                    isGeminiActive ? 'bg-success' : 'bg-warning'
                  }`}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h1 className="font-headline text-label-lg font-bold text-dark-on-surface leading-tight">
                    Teto IA
                  </h1>
                  <span
                    data-testid="ai-mode-badge"
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase border whitespace-nowrap ${
                      isGeminiActive
                        ? 'bg-success/15 text-success border-success/30'
                        : 'bg-warning/15 text-warning border-warning/30'
                    }`}
                  >
                    {aiMode === 'checking'
                      ? 'Verificando...'
                      : isGeminiActive
                      ? 'Gemini IA (Servidor)'
                      : 'Simulador Local (Demo)'}
                  </span>
                </div>
                <p className="text-body-sm text-dark-on-surface-variant text-[11px] truncate">
                  {isGeminiActive
                    ? 'Conectado via servidor seguro com dados reais da conta'
                    : 'Cálculo determinístico local sobre seus dados reais (sem LLM externo)'}
                </p>
              </div>
            </div>
          </div>

          <div className="w-8 h-8 rounded-DEFAULT bg-white p-1 flex items-center justify-center shadow-sm overflow-hidden flex-shrink-0">
            <img src={TETO_LOGO_SRC} alt="Logo Teto Finance" className="w-full h-full object-contain" />
          </div>
        </header>

        {/* Chat Stream Area */}
        <main className="flex-1 px-5 md:px-7 py-5 space-y-4 overflow-y-auto pb-40">
          {aiMode === 'local-simulator' && (
            <div
              role="note"
              className="p-3 rounded-DEFAULT bg-warning/10 border border-warning/35 text-[11px] text-dark-on-surface-variant leading-relaxed flex items-start gap-2"
            >
              <span className="material-symbols-outlined text-warning text-base flex-shrink-0 mt-0.5">
                info
              </span>
              <span>
                <strong className="text-dark-on-surface">Modo Simulador Demonstrativo:</strong> a
                chave <code className="text-dark-on-surface">GEMINI_API_KEY</code> não está
                configurada no servidor. As respostas abaixo são calculadas localmente usando os
                números reais da sua conta ativa, sem registrar movimentações automaticamente.
              </span>
            </div>
          )}

          {/* Quick Prompt Suggestions Chips */}
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              'Posso pedir pizza de R$ 55 hoje?',
              'Quanto sobra se eu guardar R$ 100?',
              'Resumo do meu teto, saldo e reserva',
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={isSending}
                onClick={() => void sendPrompt(chip)}
                className="px-3 py-1.5 rounded-full bg-dark-surface-variant border border-dark-outline hover:border-primary/50 text-dark-on-surface text-[11px] font-medium transition-colors disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>

          {messages.map((msg) =>
            msg.sender === 'user' ? (
              <div key={msg.id} className="flex items-start justify-end gap-2.5 pl-10">
                <div className="space-y-1 text-right max-w-[85%]">
                  <div className="p-3.5 rounded-lg rounded-tr-sm bg-primary text-on-primary text-body-sm text-xs leading-relaxed text-left shadow-md shadow-primary/20">
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-dark-on-surface-variant mr-1">{msg.time}</span>
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex items-start gap-2.5 max-w-[95%] md:max-w-[85%]">
                <div
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1 ${
                    msg.isError ? 'bg-error/20 text-error' : 'bg-primary/20 text-accent'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm font-bold">
                    {msg.isError ? 'error' : 'smart_toy'}
                  </span>
                </div>
                <div className="space-y-2 w-full">
                  <div
                    className={`p-3.5 rounded-lg rounded-tl-sm border text-xs leading-relaxed space-y-2.5 ${
                      msg.isError
                        ? 'bg-error/10 border-error/40 text-error'
                        : 'bg-dark-surface-variant border-dark-outline text-dark-on-surface'
                    }`}
                  >
                    <p>{msg.text}</p>

                    {msg.analysis?.decisionTitle && (
                      <div className="p-3 rounded-DEFAULT bg-dark-surface border border-primary/30 space-y-2">
                        <div className="flex items-center justify-between text-[11px] gap-2">
                          <span className="font-semibold flex items-center gap-1.5 text-accent">
                            <span className="material-symbols-outlined text-sm">analytics</span>
                            {msg.analysis.decisionTitle}
                          </span>
                          {msg.analysis.daysImpactText && (
                            <span className="text-primary font-bold whitespace-nowrap">
                              {msg.analysis.daysImpactText}
                            </span>
                          )}
                        </div>
                        {typeof msg.analysis.impactBarPercent === 'number' && (
                          <div className="h-1.5 w-full bg-dark-surface-variant rounded-full overflow-hidden">
                            <div
                              className="bg-accent h-full rounded-full"
                              style={{ width: `${msg.analysis.impactBarPercent}%` }}
                            />
                          </div>
                        )}
                        {msg.analysis.decisionSummary && (
                          <p className="text-[11px] text-dark-on-surface-variant leading-tight">
                            {msg.analysis.decisionSummary}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {msg.isError && msg.retryPrompt && (
                    <div className="flex items-center flex-wrap gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const localAnalysis = analyzeAssistantPrompt(
                            msg.retryPrompt!,
                            ceiling,
                            state,
                            referenceDate
                          );
                          setMessages((prev) => [
                            ...prev,
                            {
                              id: `ai_local_${Date.now()}`,
                              sender: 'ai',
                              time: nowTimeHHMM(),
                              text: `[Simulador Local] ${localAnalysis.replyText}`,
                              analysis: localAnalysis,
                            },
                          ]);
                        }}
                        className="px-3 py-1.5 rounded-DEFAULT bg-warning/15 border border-warning/40 text-warning text-[11px] font-semibold hover:bg-warning/25 transition-colors"
                      >
                        Calcular no Simulador Local
                      </button>
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => void sendPrompt(msg.retryPrompt!)}
                        className="px-3 py-1.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface text-[11px] font-medium hover:border-primary/50 transition-colors disabled:opacity-50"
                      >
                        Tentar Gemini novamente
                      </button>
                    </div>
                  )}

                  {msg.analysis?.amountCents && msg.analysis?.suggestedDescription && (
                    <div className="flex items-center flex-wrap gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onRegisterSuggestedExpense({
                            type: 'despesa',
                            description: msg.analysis?.suggestedDescription,
                            amountCents: msg.analysis?.amountCents,
                            categoryId: msg.analysis?.suggestedCategoryId,
                            budgetKind: 'livre',
                          })
                        }
                        className="px-3 py-1.5 rounded-DEFAULT bg-primary text-on-primary text-[11px] font-semibold hover:bg-accent transition-colors flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-xs">check</span>
                        Confirmar no Registro Rápido
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMessages((prev) => [
                            ...prev,
                            {
                              id: `ai_hold_${Date.now()}`,
                              sender: 'ai',
                              time: nowTimeHHMM(),
                              text: `Perfeito! Nenhum lançamento foi registrado e seu teto diário permanece em ${centsToBRL(
                                ceiling.dailyCeilingCents
                              )}/dia.`,
                            },
                          ]);
                          onNotifyToast('Simulação mantida sem alterar seus lançamentos.');
                        }}
                        className="px-3 py-1.5 rounded-DEFAULT bg-dark-surface border border-dark-outline hover:border-dark-on-surface-variant text-dark-on-surface text-[11px] font-medium transition-colors"
                      >
                        Apenas simular (não registrar)
                      </button>
                    </div>
                  )}

                  <span className="text-[10px] text-dark-on-surface-variant ml-1 block">
                    {msg.time}
                  </span>
                </div>
              </div>
            )
          )}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-dark-on-surface-variant pl-9">
              <span className="material-symbols-outlined text-sm animate-spin text-accent">
                progress_activity
              </span>
              <span>Consultando servidor Gemini com seu contexto...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Bottom Input Dock with Persistent Mini Nav */}
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 max-w-[420px] md:max-w-[780px] lg:max-w-[920px] w-full bg-dark-surface/95 backdrop-blur-md border-t border-dark-outline px-4 md:px-7 pt-3 pb-2 z-30 space-y-2">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                aria-label="Pergunte sobre seu teto ou gastos"
                placeholder="Pergunte sobre seu teto, saldo ou simule um gasto..."
                className="w-full pl-4 pr-4 py-2.5 rounded-full bg-dark-surface-variant border border-dark-outline text-dark-on-surface placeholder-dark-on-surface-variant text-body-sm text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              aria-label="Enviar mensagem"
              className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center flex-shrink-0 hover:bg-accent disabled:opacity-50 transition-colors shadow-md shadow-primary/20"
            >
              <span className="material-symbols-outlined text-lg">send</span>
            </button>
          </form>

          <div className="flex justify-between md:justify-center md:gap-8 items-center px-2 pt-1 text-[10px] text-dark-on-surface-variant">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="hover:text-dark-on-surface flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">roofing</span> Painel
            </button>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="hover:text-dark-on-surface flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">monitoring</span> Relatórios
            </button>
            <button
              type="button"
              onClick={() => onNavigate('goals')}
              className="hover:text-dark-on-surface flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">military_tech</span> Metas
            </button>
            <button
              type="button"
              onClick={() => onNavigate('statement')}
              className="hover:text-dark-on-surface flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">receipt_long</span> Extrato
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
