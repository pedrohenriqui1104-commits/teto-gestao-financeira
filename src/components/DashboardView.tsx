import { useMemo, useState } from 'react';
import {
  calculateMicrospendingRadar,
  calculateReserveBalanceCents,
  resolveExpenseBudgetKind,
} from '../domain/ceilingEngine';
import { centsToBRL, formatShortDateBR } from '../domain/formatters';
import type {
  Category,
  DailyCeilingResult,
  Transaction,
  WorkspaceState,
} from '../domain/types';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

interface DashboardViewProps {
  state: WorkspaceState;
  ceiling: DailyCeilingResult;
  periodLabel: string;
  monthOffset: number;
  referenceDate: string;
  periodTransactions: Transaction[];
  onChangeMonthOffset: (offset: number) => void;
  onUpdateClosingDay: (closingDay: number) => void;
  onNavigate: (view: AppView) => void;
  onOpenScanner: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onNotifyToast: (msg: string, tone?: ToastNotice['tone']) => void;
  toasts: ToastNotice[];
}

function getCategoryMeta(categories: Category[], categoryId: string): Category | undefined {
  return categories.find((c) => c.id === categoryId);
}

function formatNumericAmountWithoutSymbol(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe / 100);
}

export function DashboardView({
  state,
  ceiling,
  periodLabel,
  monthOffset,
  referenceDate,
  periodTransactions,
  onChangeMonthOffset,
  onUpdateClosingDay,
  onNavigate,
  onOpenScanner,
  onEditTransaction,
  onNotifyToast,
  toasts,
}: DashboardViewProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [allMovementsOpen, setAllMovementsOpen] = useState(false);
  const [closingDayDraft, setClosingDayDraft] = useState(String(state.settings.cycleClosingDay));
  const [closingDayError, setClosingDayError] = useState<string | null>(null);

  const firstName = state.profile.name.trim().split(' ')[0] || 'Usuário';

  const reserveBalanceCents = useMemo(
    () => calculateReserveBalanceCents(state.reserveMovements),
    [state.reserveMovements]
  );

  const radar = useMemo(
    () => calculateMicrospendingRadar(periodTransactions, state.categories, ceiling),
    [periodTransactions, state.categories, ceiling]
  );

  const activePeriodTxs = useMemo(
    () => periodTransactions.filter((tx) => tx.status !== 'cancelado' && !tx.isReversal),
    [periodTransactions]
  );

  const recentTxs = useMemo(() => activePeriodTxs.slice(0, 4), [activePeriodTxs]);

  const todayVariableSpentCents = useMemo(
    () =>
      activePeriodTxs
        .filter(
          (tx) =>
            tx.type === 'despesa' &&
            tx.date === referenceDate &&
            resolveExpenseBudgetKind(tx, state.categories) === 'livre'
        )
        .reduce((acc, tx) => acc + tx.amountCents, 0),
    [activePeriodTxs, referenceDate, state.categories]
  );

  // Percentual consumido do Teto Livre Planejado
  const consumedPct = useMemo(() => {
    if (ceiling.plannedFreeCeilingCents <= 0) {
      return ceiling.periodVariableExpensesCents > 0 ? 100 : 0;
    }
    return Math.min(
      100,
      Math.max(
        0,
        Math.round((ceiling.periodVariableExpensesCents / ceiling.plannedFreeCeilingCents) * 100)
      )
    );
  }, [ceiling.plannedFreeCeilingCents, ceiling.periodVariableExpensesCents]);

  // Mensagem preventiva real com base no Teto Diário
  const preventiveMessage = useMemo(() => {
    if (ceiling.isPeriodClosed) {
      return `Ciclo encerrado. Saldo livre final registrado: ${centsToBRL(
        ceiling.availableToSpendCents
      )}.`;
    }
    if (ceiling.isDeficit) {
      return `Seu orçamento está pressionado em ${centsToBRL(
        Math.abs(ceiling.availableToSpendCents)
      )}. Priorize despesas essenciais ou ajuste sua reserva.`;
    }
    if (todayVariableSpentCents > 0 && ceiling.dailyCeilingCents > 0) {
      if (todayVariableSpentCents > ceiling.dailyCeilingCents) {
        return `Seus gastos livres de hoje somaram ${centsToBRL(
          todayVariableSpentCents
        )}, acima do teto diário de ${centsToBRL(
          ceiling.dailyCeilingCents
        )}. Segure o ritmo amanhã para proteger a reserva.`;
      }
      return `Você já registrou ${centsToBRL(
        todayVariableSpentCents
      )} em gastos livres hoje. Ainda restam ${centsToBRL(
        Math.max(0, ceiling.dailyCeilingCents - todayVariableSpentCents)
      )} seguros para o dia.`;
    }
    if (ceiling.futureCommitmentsCents > 0) {
      return `Você possui ${ceiling.futureCommitmentsCount} compromisso(s) futuro(s) somando ${centsToBRL(
        ceiling.futureCommitmentsCents
      )}. Mantenha o limite diário para preservar sua reserva.`;
    }
    return `Nenhum gasto livre registrado hoje. Seu teto seguro de ${centsToBRL(
      ceiling.dailyCeilingCents
    )}/dia está intacto para os próximos ${ceiling.remainingDays} dias.`;
  }, [ceiling, todayVariableSpentCents]);

  const notifications = useMemo(() => {
    const list: Array<{
      id: string;
      badge: string;
      badgeTone: string;
      time: string;
      title: string;
      body: string;
      highlight?: boolean;
    }> = [
      {
        id: 'notif-teto',
        badge: ceiling.isDeficit ? 'Teto Excedido' : 'Alerta de Teto',
        badgeTone: ceiling.isDeficit ? 'bg-error/20 text-error' : 'bg-primary/20 text-accent',
        time: 'Agora',
        title: `Consumo do Teto Livre em ${consumedPct}%`,
        body: `Você consumiu ${centsToBRL(
          ceiling.periodVariableExpensesCents
        )} de ${centsToBRL(Math.max(0, ceiling.plannedFreeCeilingCents))} planejados para o ciclo.`,
        highlight: true,
      },
      {
        id: 'notif-reserva',
        badge: 'Meta de Reserva',
        badgeTone: 'bg-success/20 text-success',
        time: 'Ciclo atual',
        title: `Reserva acumulada em ${centsToBRL(reserveBalanceCents)}`,
        body:
          ceiling.periodReserveNetCents > 0
            ? `Você já direcionou ${centsToBRL(ceiling.periodReserveNetCents)} líquidos para a reserva neste período.`
            : 'Nenhum aporte líquido registrado neste período ainda.',
      },
    ];

    if (radar.variableExpensesCount > 0) {
      list.push({
        id: 'notif-micro',
        badge: 'Microgastos',
        badgeTone: 'bg-warning/20 text-warning',
        time: `${radar.variableExpensesCount} registros`,
        title: `${radar.variableExpensesCount} gasto(s) livres monitorados`,
        body: `Total variável do ciclo em ${centsToBRL(
          radar.totalVariableCents
        )}. Registrar na hora mantém o Teto Diário preciso.`,
      });
    }

    return list;
  }, [ceiling, consumedPct, radar, reserveBalanceCents]);

  const formatTxDateLabel = (dateIso: string) => {
    if (dateIso === referenceDate) return 'Hoje';
    return formatShortDateBR(dateIso);
  };

  return (
    <StitchShell
      activeView="dashboard"
      onNavigate={onNavigate}
      isBrandHeader
      subtitle={`Olá, ${firstName}`}
      toasts={toasts}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('statement')}
            aria-label="Abrir Extrato Completo"
            title="Extrato Completo e Recorrências"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-dark-surface-variant text-dark-on-surface-variant border border-dark-outline hover:text-dark-on-surface hover:border-primary/50 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">account_balance</span>
          </button>
          <button
            type="button"
            onClick={() => setNotifOpen(true)}
            aria-label="Alertas e Notificações"
            className="relative inline-flex items-center justify-center w-9 h-9 rounded-full bg-dark-surface-variant text-dark-on-surface-variant border border-dark-outline hover:text-dark-on-surface hover:border-primary/50 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">notifications</span>
            {unreadAlerts && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary ring-2 ring-dark-surface" />
            )}
          </button>
        </div>
      }
    >
      {/* Gamification & Status Banner */}
      <div className="flex items-center justify-between p-3 rounded-DEFAULT bg-dark-surface-variant/70 border border-dark-outline">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
              ceiling.healthStatus === 'critico'
                ? 'bg-error/20 text-error'
                : ceiling.healthStatus === 'atencao'
                ? 'bg-warning/20 text-warning'
                : 'bg-success/20 text-success'
            }`}
          >
            <span className="material-symbols-outlined text-sm font-bold">
              {ceiling.healthStatus === 'critico' ? 'warning' : 'verified'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-label-md text-dark-on-surface font-semibold leading-tight">
              {radar.daysWithinCeiling} dias dentro do teto
            </p>
            <p className="text-body-sm text-dark-on-surface-variant text-[11px] leading-snug">
              {radar.estimatedSavingsCents > 0
                ? `Economia estimada de ${centsToBRL(radar.estimatedSavingsCents)} no ciclo`
                : `Saldo em caixa: ${centsToBRL(ceiling.currentCashBalanceCents)}`}
            </p>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 text-[10px] font-semibold flex-shrink-0 whitespace-nowrap">
          Nível {state.profile.level} • {state.profile.plan === 'premium' ? 'Premium' : 'Gratuito'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        <div className="md:col-span-7 space-y-5 min-w-0">
          {/* Core Hero Widget: Painel de Orçamento Reverso & Teto Gastável Diário */}
          <section className="p-5 sm:p-6 rounded-lg bg-gradient-to-b from-dark-surface-variant via-dark-surface-variant to-[#17181F] border border-dark-outline relative overflow-hidden shadow-lg">
            <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />

            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-label-md font-medium text-dark-on-surface-variant uppercase tracking-wider text-[11px]">
                  Teto Livre Disponível
                </span>
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  aria-label="Como funciona o Teto?"
                  className="text-dark-on-surface-variant hover:text-accent flex items-center"
                >
                  <span className="material-symbols-outlined text-sm">info</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setClosingDayDraft(String(state.settings.cycleClosingDay));
                  setClosingDayError(null);
                  setFilterOpen(true);
                }}
                aria-label="Alterar período do orçamento"
                className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/20 text-accent font-semibold border border-primary/30 hover:bg-primary/30 transition-colors whitespace-nowrap"
              >
                {periodLabel}
              </button>
            </div>

        {/* Big Highlight Metric */}
        <div className="my-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-headline-md font-bold text-dark-on-surface-variant">R$</span>
            <span
              data-testid="available-ceiling-value"
              className={`font-headline text-display-lg-mobile font-extrabold tracking-tight tabular-nums whitespace-nowrap ${
                ceiling.isDeficit ? 'text-error' : 'text-dark-on-surface'
              }`}
            >
              {formatNumericAmountWithoutSymbol(ceiling.availableToSpendCents)}
            </span>
          </div>
          <p className="text-body-sm text-dark-on-surface-variant text-xs mt-1">
            de um teto mensal de{' '}
            <span className="text-dark-on-surface font-semibold tabular-nums whitespace-nowrap">
              {centsToBRL(ceiling.plannedFreeCeilingCents)}
            </span>
          </p>
          {ceiling.periodPendingRevenuesCents > 0 && (
            <p className="text-[11px] text-warning mt-1 tabular-nums">
              + {centsToBRL(ceiling.periodPendingRevenuesCents)} em receitas pendentes (entram no teto ao confirmar)
            </p>
          )}
        </div>

        {/* Destaque Central do Teto Gastável Diário */}
        <div
          data-testid="daily-ceiling-highlight"
          className="mt-3 p-3 rounded-DEFAULT bg-dark-surface/85 border border-primary/40 flex items-center justify-between gap-2"
        >
          <div>
            <p className="text-[10px] uppercase tracking-wider text-dark-on-surface-variant font-semibold">
              Teto Gastável Diário
            </p>
            <p className="font-headline text-headline-md font-extrabold text-accent tabular-nums whitespace-nowrap">
              {centsToBRL(ceiling.dailyCeilingCents)}
              <span className="text-xs font-medium text-dark-on-surface-variant">/dia</span>
            </p>
          </div>
          <div className="text-right">
            <span className="inline-block px-2 py-0.5 rounded-full bg-primary/15 text-accent text-[10px] font-bold border border-primary/30 whitespace-nowrap">
              {ceiling.isPeriodClosed
                ? 'Ciclo encerrado'
                : `${ceiling.remainingDays} ${ceiling.remainingDays === 1 ? 'dia restante' : 'dias restantes'}`}
            </span>
            {!ceiling.isPeriodClosed && ceiling.dailyCarryoverDeltaCents !== 0 && (
              <p
                className={`text-[10px] mt-1 tabular-nums whitespace-nowrap ${
                  ceiling.dailyCarryoverDeltaCents > 0 ? 'text-success' : 'text-dark-on-surface-variant'
                }`}
              >
                {ceiling.dailyCarryoverDeltaCents > 0 ? '+' : ''}
                {centsToBRL(ceiling.dailyCarryoverDeltaCents)} vs ontem
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar Indicator */}
        <div className="space-y-1.5 my-4">
          <div className="h-2.5 w-full rounded-full bg-dark-surface border border-dark-outline/70 overflow-hidden p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
              style={{ width: `${consumedPct}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-dark-on-surface-variant">
            <span>{consumedPct}% do teto consumido</span>
            <span className="font-medium text-accent tabular-nums whitespace-nowrap">
              {centsToBRL(ceiling.periodVariableExpensesCents)} gastos
            </span>
          </div>
        </div>

        {/* Reverse Budget Triad */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-dark-outline/60 mt-3">
          <div className="p-2.5 rounded-DEFAULT bg-dark-surface/60 border border-dark-outline/50">
            <div className="flex items-center gap-1.5 mb-1 text-dark-on-surface-variant">
              <span className="material-symbols-outlined text-xs">lock</span>
              <span className="text-[11px] font-medium">Gastos Fixos</span>
            </div>
            <p className="text-headline-sm font-bold text-dark-on-surface tabular-nums whitespace-nowrap">
              {centsToBRL(ceiling.periodFixedExpensesCents)}
            </p>
            <p className="text-[10px] text-dark-on-surface-variant">
              {ceiling.futureCommitmentsCount > 0
                ? `${ceiling.futureCommitmentsCount} futuros (${centsToBRL(ceiling.futureCommitmentsCents)})`
                : 'Aluguel, contas & fixos'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('goals')}
            className="p-2.5 rounded-DEFAULT bg-dark-surface/60 border border-dark-outline/50 hover:border-success/40 text-left transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1 text-dark-on-surface-variant">
              <span className="material-symbols-outlined text-xs text-success">savings</span>
              <span className="text-[11px] font-medium">Reserva Futura</span>
            </div>
            <p className="text-headline-sm font-bold text-dark-on-surface tabular-nums whitespace-nowrap">
              {centsToBRL(ceiling.periodReserveNetCents)}
            </p>
            <p className="text-[10px] text-success font-medium tabular-nums whitespace-nowrap">
              Acumulada: {centsToBRL(reserveBalanceCents)}
            </p>
          </button>
        </div>
      </section>

      {/* Prevenção Comportamental & Alerta Proativo */}
      <section className="p-4 rounded-DEFAULT bg-primary/10 border border-primary/30 flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/20 text-accent flex-shrink-0 flex items-center justify-center mt-0.5">
          <span className="material-symbols-outlined text-lg">crisis_alert</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-label-md font-semibold text-dark-on-surface">
              Lembrete Preventivo
            </h3>
            <span className="text-[10px] text-accent font-semibold tabular-nums whitespace-nowrap">
              Teto Diário: {centsToBRL(ceiling.dailyCeilingCents)}
            </span>
          </div>
          <p className="text-body-sm text-dark-on-surface-variant text-xs mt-1 leading-relaxed">
            {preventiveMessage}
          </p>
        </div>
      </section>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onOpenScanner}
          className="flex items-center justify-center gap-1.5 py-3.5 px-2.5 rounded-DEFAULT bg-primary text-on-primary font-headline text-label-md font-semibold shadow-md shadow-primary/20 hover:bg-accent transition-all active:scale-[0.98] whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px] flex-shrink-0">document_scanner</span>
          <span>Escanear Nota</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('ai-chat')}
          className="flex items-center justify-center gap-1.5 py-3.5 px-2.5 rounded-DEFAULT bg-dark-surface-variant text-dark-on-surface border border-dark-outline hover:border-primary/50 font-headline text-label-md font-semibold transition-colors active:scale-[0.98] whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px] text-primary flex-shrink-0">auto_awesome</span>
          <span>Assistente IA</span>
        </button>
      </div>
        </div>

        <div className="md:col-span-5 space-y-5 min-w-0">
      {/* Movimentações Recentes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-headline text-headline-sm text-dark-on-surface font-semibold truncate">
              Movimentações Recentes
            </h3>
            <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-dark-surface-variant text-[10px] text-dark-on-surface-variant font-medium border border-dark-outline items-center gap-1 whitespace-nowrap flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Ciclo ativo
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAllMovementsOpen(true)}
            className="text-label-sm text-accent hover:underline font-semibold whitespace-nowrap flex-shrink-0"
          >
            Ver todas
          </button>
        </div>

        {recentTxs.length === 0 ? (
          <div className="p-5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-center space-y-2">
            <p className="text-xs font-semibold text-dark-on-surface">
              Nenhuma movimentação neste período ainda
            </p>
            <p className="text-[11px] text-dark-on-surface-variant">
              Cadastre suas receitas e despesas no botão + para calcular seu teto diário automaticamente.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {recentTxs.map((tx) => {
              const cat = getCategoryMeta(state.categories, tx.categoryId);
              const budgetKind =
                tx.type === 'receita' ? null : resolveExpenseBudgetKind(tx, state.categories);
              const isRevenue = tx.type === 'receita';

              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => onEditTransaction(tx)}
                  className="w-full p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline flex items-center justify-between hover:border-dark-on-surface-variant/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isRevenue
                          ? 'bg-success/15 text-success'
                          : budgetKind === 'fixo'
                          ? 'bg-[#1F2937] text-warning'
                          : 'bg-primary-container text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-lg">
                        {cat?.icon ?? (isRevenue ? 'payments' : 'receipt')}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-label-md font-semibold text-dark-on-surface truncate">
                        {tx.description}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-body-sm text-dark-on-surface-variant text-[11px]">
                          {formatTxDateLabel(tx.date)} • {cat?.name ?? 'Geral'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-dark-surface text-[9px] text-dark-on-surface-variant">
                          {isRevenue ? 'Receita' : budgetKind === 'fixo' ? 'Fixo' : 'Livre'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p
                      className={`font-headline text-label-lg font-bold tabular-nums whitespace-nowrap ${
                        isRevenue ? 'text-success' : 'text-dark-on-surface'
                      }`}
                    >
                      {isRevenue ? '+ ' : '- '}
                      {centsToBRL(tx.amountCents)}
                    </p>
                    <span className="text-[10px] text-dark-on-surface-variant">
                      {tx.status === 'pago' ? 'Confirmado' : 'Pendente'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Mini Card Plano Premium */}
      <section className="p-4 rounded-DEFAULT bg-gradient-to-r from-dark-surface-variant to-[#1C1820] border border-primary/30 flex items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-headline text-label-md font-bold text-dark-on-surface">
              Teto Premium
            </span>
            <span className="px-1.5 py-0.5 rounded bg-primary text-on-primary text-[9px] font-bold whitespace-nowrap">
              R$ 19,90/mês
            </span>
          </div>
          <p className="text-body-sm text-dark-on-surface-variant text-[11px]">
            {state.profile.plan === 'premium'
              ? 'Radar de microgastos desbloqueado na sua conta'
              : 'Diagnóstico semanal e radar avançado de microgastos (Demo)'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('plans')}
          className="px-3 py-1.5 rounded-sm bg-primary/20 text-accent border border-primary/40 font-headline text-label-sm font-semibold hover:bg-primary hover:text-on-primary transition-colors flex-shrink-0"
        >
          {state.profile.plan === 'premium' ? 'Ativo' : 'Testar'}
        </button>
      </section>
        </div>
      </div>

      {/* Drawer: Notificações e Alertas */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Notificações"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNotifOpen(false);
          }}
        >
          <div className="w-[85%] max-w-[340px] h-full bg-dark-surface-variant border-l border-dark-outline p-5 flex flex-col justify-between shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-dark-outline/70 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-xl">
                    notifications_active
                  </span>
                  <h3 className="font-headline text-label-lg font-bold text-dark-on-surface">
                    Notificações
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  aria-label="Fechar notificações"
                  className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <div className="space-y-2.5 overflow-y-auto max-h-[75vh]">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-DEFAULT bg-dark-surface border space-y-1 ${
                      n.highlight ? 'border-primary/40' : 'border-dark-outline'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={`px-1.5 py-0.2 rounded font-bold ${n.badgeTone}`}>
                        {n.badge}
                      </span>
                      <span className="text-dark-on-surface-variant">{n.time}</span>
                    </div>
                    <p className="text-xs font-semibold text-dark-on-surface">{n.title}</p>
                    <p className="text-[11px] text-dark-on-surface-variant leading-tight">
                      {n.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setUnreadAlerts(false);
                setNotifOpen(false);
                onNotifyToast('Todas as notificações foram lidas');
              }}
              className="w-full py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold hover:border-primary/50 transition-colors"
            >
              Marcar todas como lidas
            </button>
          </div>
        </div>
      )}

      {/* Modal: Período do Teto */}
      {filterOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="period-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFilterOpen(false);
          }}
        >
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">date_range</span>
                <h3 id="period-modal-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                  Período do Teto
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                aria-label="Fechar modal de período"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="space-y-2">
              {[
                { offset: 0, title: 'Ciclo Atual', tag: 'Atual' },
                { offset: -1, title: 'Ciclo Anterior', tag: 'Histórico' },
                { offset: 1, title: 'Próximo Ciclo', tag: 'Previsão' },
              ].map((opt) => {
                const selected = monthOffset === opt.offset;
                return (
                  <button
                    key={opt.offset}
                    type="button"
                    onClick={() => {
                      onChangeMonthOffset(opt.offset);
                      setFilterOpen(false);
                    }}
                    className={`w-full p-3 rounded-DEFAULT border text-left flex items-center justify-between transition-colors ${
                      selected
                        ? 'bg-primary/20 border-primary text-dark-on-surface'
                        : 'bg-dark-surface border-dark-outline text-dark-on-surface hover:border-primary/50'
                    }`}
                  >
                    <span className="text-xs font-semibold">{opt.title}</span>
                    <span
                      className={`text-[10px] font-bold ${
                        selected ? 'text-accent' : 'text-dark-on-surface-variant'
                      }`}
                    >
                      {selected ? 'Ativo' : opt.tag}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-dark-outline space-y-2">
              <label
                htmlFor="closingDayInput"
                className="block text-[11px] font-medium text-dark-on-surface-variant"
              >
                Dia de fechamento do ciclo (0 = mês calendário, ou 1 a 28)
              </label>
              {closingDayError && (
                <div
                  role="alert"
                  className="p-2 rounded bg-error/10 border border-error/40 text-[11px] text-error"
                >
                  {closingDayError}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  id="closingDayInput"
                  type="number"
                  min={0}
                  max={28}
                  value={closingDayDraft}
                  onChange={(e) => {
                    setClosingDayDraft(e.target.value);
                    setClosingDayError(null);
                  }}
                  className="flex-1 px-3 py-2 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = closingDayDraft.trim();
                    const parsed = Number(trimmed);
                    if (!trimmed || !Number.isInteger(parsed) || parsed < 0 || parsed > 28) {
                      setClosingDayError('Informe um número inteiro entre 0 e 28.');
                      return;
                    }
                    onUpdateClosingDay(parsed);
                    setFilterOpen(false);
                  }}
                  className="px-4 py-2 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Como funciona o Teto */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="info-teto-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInfoOpen(false);
          }}
        >
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">help</span>
                <h3 id="info-teto-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                  Como funciona o Teto?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                aria-label="Fechar explicação do Teto"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-dark-on-surface-variant leading-relaxed">
              <p>
                O <strong className="text-dark-on-surface">Orçamento Reverso</strong> calcula quanto você realmente pode gastar sem comprometer o ciclo:
              </p>
              <div className="p-3 rounded-DEFAULT bg-dark-surface border border-dark-outline/70 space-y-1.5 font-mono text-[11px]">
                {ceiling.carryoverBeforePeriodCents !== 0 && (
                  <div className="flex justify-between text-dark-on-surface-variant">
                    <span>Saldo Anterior:</span>
                    <strong className="tabular-nums whitespace-nowrap">
                      {centsToBRL(ceiling.carryoverBeforePeriodCents)}
                    </strong>
                  </div>
                )}
                <div className="flex justify-between text-dark-on-surface">
                  <span>Receitas do Ciclo:</span>
                  <strong className="tabular-nums whitespace-nowrap">
                    {centsToBRL(ceiling.periodRevenuesCents)}
                  </strong>
                </div>
                <div className="flex justify-between text-warning">
                  <span>(-) Gastos Fixos:</span>
                  <strong className="tabular-nums whitespace-nowrap">
                    - {centsToBRL(ceiling.periodFixedExpensesCents)}
                  </strong>
                </div>
                <div className="flex justify-between text-success">
                  <span>(-) Reserva Guardada:</span>
                  <strong className="tabular-nums whitespace-nowrap">
                    - {centsToBRL(ceiling.periodReserveNetCents)}
                  </strong>
                </div>
                <div className="flex justify-between text-dark-on-surface border-t border-dark-outline/70 pt-1">
                  <span>(=) Teto Livre Planejado:</span>
                  <strong className="tabular-nums whitespace-nowrap">
                    {centsToBRL(ceiling.plannedFreeCeilingCents)}
                  </strong>
                </div>
                <div className="flex justify-between text-dark-on-surface-variant">
                  <span>(-) Gastos Livres:</span>
                  <strong className="tabular-nums whitespace-nowrap">
                    - {centsToBRL(ceiling.periodVariableExpensesCents)}
                  </strong>
                </div>
                <div className="flex justify-between text-accent border-t border-dark-outline pt-1 font-bold">
                  <span>(=) Teto Livre Atual:</span>
                  <span className="tabular-nums whitespace-nowrap">
                    {centsToBRL(ceiling.availableToSpendCents)}
                  </span>
                </div>
              </div>
              <p>
                Dividimos o teto livre pelos{' '}
                <strong className="text-dark-on-surface">{ceiling.remainingDays} dias</strong> restantes (truncado em centavos) para obter seu{' '}
                <strong className="text-accent">
                  Teto Diário de {centsToBRL(ceiling.dailyCeilingCents)}
                </strong>
                .
              </p>
            </div>

            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
            >
              Entendi, voltar ao Painel
            </button>
          </div>
        </div>
      )}

      {/* Modal: Extrato Rápido */}
      {allMovementsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-statement-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAllMovementsOpen(false);
          }}
        >
          <div className="w-full max-w-sm bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl max-h-[85vh] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-dark-outline pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-xl">
                    receipt_long
                  </span>
                  <h3 id="quick-statement-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                    Extrato do Ciclo
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setAllMovementsOpen(false)}
                  aria-label="Fechar extrato rápido"
                  className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <div className="space-y-2 mt-3 overflow-y-auto max-h-[52vh]">
                {periodTransactions.length === 0 ? (
                  <p className="text-xs text-dark-on-surface-variant py-6 text-center">
                    Nenhuma movimentação registrada neste período.
                  </p>
                ) : (
                  periodTransactions.map((tx) => {
                    const cat = getCategoryMeta(state.categories, tx.categoryId);
                    const isRev = tx.type === 'receita';
                    const isCancelled = tx.status === 'cancelado';
                    return (
                      <div
                        key={tx.id}
                        className={`p-2.5 rounded bg-dark-surface border border-dark-outline flex justify-between items-center text-xs ${
                          isCancelled ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className={`font-semibold text-dark-on-surface truncate ${isCancelled ? 'line-through' : ''}`}>
                            {tx.description}
                          </p>
                          <p className="text-[10px] text-dark-on-surface-variant">
                            {formatShortDateBR(tx.date)} • {cat?.name ?? 'Geral'}
                          </p>
                        </div>
                        <span
                          className={`font-bold tabular-nums whitespace-nowrap ${
                            isCancelled
                              ? 'text-dark-on-surface-variant'
                              : isRev
                              ? 'text-success'
                              : 'text-accent'
                          }`}
                        >
                          {isRev ? '+ ' : '- '}
                          {centsToBRL(tx.amountCents)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-2 flex gap-2 border-t border-dark-outline">
              <button
                type="button"
                onClick={() => {
                  setAllMovementsOpen(false);
                  onNavigate('statement');
                }}
                className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Gerenciar Extrato
              </button>
              <button
                type="button"
                onClick={() => {
                  setAllMovementsOpen(false);
                  onNavigate('quick-record');
                }}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Novo Registro
              </button>
            </div>
          </div>
        </div>
      )}
    </StitchShell>
  );
}
