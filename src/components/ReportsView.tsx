import { useMemo } from 'react';
import {
  calculateCategoryBreakdown,
  calculateMicrospendingRadar,
  calculateWeeklyConsumption,
} from '../domain/ceilingEngine';
import { centsToBRL, formatDateBR } from '../domain/formatters';
import type {
  DailyCeilingResult,
  Transaction,
  WorkspaceState,
} from '../domain/types';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

interface ReportsViewProps {
  state: WorkspaceState;
  ceiling: DailyCeilingResult;
  periodLabel: string;
  periodTransactions: Transaction[];
  referenceDate: string;
  onNavigate: (view: AppView) => void;
  onNotifyToast: (msg: string, tone?: ToastNotice['tone']) => void;
  toasts: ToastNotice[];
}

export function ReportsView({
  state,
  ceiling,
  periodLabel,
  periodTransactions,
  referenceDate,
  onNavigate,
  onNotifyToast,
  toasts,
}: ReportsViewProps) {
  const isPremium = state.profile.plan === 'premium';

  const weeklyRows = useMemo(
    () =>
      calculateWeeklyConsumption(
        state,
        ceiling.periodStart,
        ceiling.periodEnd,
        referenceDate,
        ceiling.plannedFreeCeilingCents
      ),
    [state, ceiling.periodStart, ceiling.periodEnd, referenceDate, ceiling.plannedFreeCeilingCents]
  );

  const radar = useMemo(
    () => calculateMicrospendingRadar(periodTransactions, state.categories, ceiling),
    [periodTransactions, state.categories, ceiling]
  );

  const categoryBreakdown = useMemo(
    () => calculateCategoryBreakdown(periodTransactions, state.categories, 'despesa'),
    [periodTransactions, state.categories]
  );

  const weeksWithinLimitCount = weeklyRows.filter((w) => w.withinLimit).length;

  const handleExportCsv = () => {
    const header = ['Data', 'Tipo', 'Categoria', 'Descricao', 'Valor(R$)', 'Status', 'Modalidade'];
    const rows = periodTransactions.map((tx) => {
      const cat = state.categories.find((c) => c.id === tx.categoryId)?.name ?? 'Geral';
      const val = (tx.amountCents / 100).toFixed(2).replace('.', ',');
      const kind = tx.type === 'receita' ? 'Receita' : tx.budgetKind === 'fixo' ? 'Fixo' : 'Livre';
      return [
        formatDateBR(tx.date),
        tx.type === 'receita' ? 'Receita' : 'Despesa',
        cat,
        `"${tx.description.replace(/"/g, '""')}"`,
        val,
        tx.status,
        kind,
      ].join(';');
    });

    const csvContent = '\uFEFF' + [header.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `teto-relatorio-${ceiling.periodStart}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onNotifyToast('Relatório CSV exportado com sucesso');
  };

  return (
    <StitchShell
      activeView="reports"
      onNavigate={onNavigate}
      showBack
      backTo="dashboard"
      title="Relatórios & Diagnóstico"
      subtitle="Diagnóstico do teto e mapa de microgastos"
      toasts={toasts}
    >
      {/* Tier Indicator Banner */}
      <section className="p-3.5 rounded-DEFAULT bg-dark-surface-variant/80 border border-dark-outline flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              isPremium ? 'bg-primary' : 'bg-success'
            }`}
          />
          <div className="min-w-0">
            <p className="text-label-md font-semibold text-dark-on-surface text-xs truncate">
              {isPremium ? 'Plano Premium Ativo' : 'Plano Básico Ativo'}
            </p>
            <p className="text-body-sm text-dark-on-surface-variant text-[11px] truncate">
              {isPremium
                ? 'Radar preditivo e diagnóstico completo liberados'
                : 'Relatório mensal e teto essencial'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('plans')}
          className="px-2.5 py-1 rounded bg-primary/20 text-accent border border-primary/30 text-[10px] font-bold hover:bg-primary hover:text-on-primary transition-colors flex-shrink-0"
        >
          {isPremium ? 'Gerenciar Plano' : 'Upgrade Premium'}
        </button>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        <div className="md:col-span-6 space-y-5 min-w-0">
      {/* 1. RECURSO GRATUITO: Consumo do Teto por Semana */}
      <section className="p-5 rounded-lg bg-dark-surface-variant border border-dark-outline space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="px-2 py-0.5 rounded bg-dark-surface text-dark-on-surface-variant text-[9px] font-bold uppercase tracking-wider">
              Recurso Gratuito
            </span>
            <h3 className="font-headline text-headline-sm text-dark-on-surface font-semibold mt-1">
              Consumo do Teto por Semana
            </h3>
          </div>
          <span className="text-[11px] text-dark-on-surface-variant text-right">{periodLabel}</span>
        </div>

        <div className="space-y-2.5 pt-2">
          {weeklyRows.map((wk) => (
            <div key={wk.weekNumber} className="space-y-1">
              <div className="flex justify-between text-[11px] gap-2">
                <span
                  className={
                    wk.isCurrent
                      ? 'text-dark-on-surface font-semibold'
                      : 'text-dark-on-surface-variant'
                  }
                >
                  {wk.label}
                </span>
                <span
                  className={`font-semibold tabular-nums whitespace-nowrap ${
                    wk.withinLimit ? 'text-dark-on-surface' : 'text-accent'
                  }`}
                >
                  {centsToBRL(wk.spentCents)} / {centsToBRL(wk.targetCents)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-dark-surface overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    wk.withinLimit ? 'bg-success' : 'bg-primary'
                  }`}
                  style={{ width: `${wk.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-dark-on-surface-variant pt-1">
          Você manteve {weeksWithinLimitCount} de {weeklyRows.length} semanas dentro da meta livre planejada.
        </p>
      </section>

      {/* 2. RECURSO PREMIUM: Radar de Microgastos (Análise Local) */}
      <section className="p-5 rounded-lg bg-gradient-to-b from-[#21171A] to-dark-surface-variant border border-primary/50 relative overflow-hidden shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-base">
              {isPremium ? 'radar' : 'lock'}
            </span>
            <span className="px-2 py-0.5 rounded bg-primary text-on-primary text-[9px] font-bold uppercase tracking-wider">
              {isPremium ? 'Radar Desbloqueado' : 'Exclusivo Premium'}
            </span>
          </div>
          <span className="text-[11px] text-accent font-semibold">Análise Local</span>
        </div>

        <h3 className="font-headline text-headline-sm text-dark-on-surface font-bold">
          Radar de Microgastos Invisíveis
        </h3>
        <p className="text-body-sm text-dark-on-surface-variant text-xs mt-0.5 leading-relaxed">
          Mapeamento de gastos variáveis por dia da semana e concentração por categoria antes do teto acabar.
        </p>

        <div className="my-4 p-4 rounded-DEFAULT bg-dark-surface/80 border border-dark-outline/70 relative min-h-[150px]">
          {isPremium && !radar.hasEnoughData ? (
            <div className="text-center py-4 space-y-1.5">
              <span className="material-symbols-outlined text-warning text-2xl">insights</span>
              <p className="text-xs font-semibold text-dark-on-surface">
                Dados insuficientes para o radar neste ciclo
              </p>
              <p className="text-[11px] text-dark-on-surface-variant leading-relaxed">
                Registre pelo menos 3 despesas livres neste ciclo para o radar identificar padrões ({radar.variableExpensesCount}/3 registradas).
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 text-[11px] gap-2">
                <span className="text-dark-on-surface font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-accent text-sm">crisis_alert</span>
                  Pico Detectado
                </span>
                <span className="text-accent font-bold text-right">{radar.peakWindowLabel}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px] text-dark-on-surface-variant">
                {(radar.items.length > 0
                  ? radar.items
                  : [
                      { label: 'Delivery', percentage: 42 },
                      { label: 'Cafés', percentage: 28 },
                      { label: 'Uber/Pix', percentage: 18 },
                      { label: 'Outros', percentage: 12 },
                    ]
                )
                  .slice(0, 4)
                  .map((item) => (
                    <div
                      key={item.label}
                      className="p-2 rounded bg-dark-surface border border-dark-outline"
                    >
                      <span className="block text-dark-on-surface font-bold tabular-nums">
                        {item.percentage}%
                      </span>
                      <span className="truncate block">{item.label}</span>
                    </div>
                  ))}
              </div>
            </>
          )}

          {!isPremium && (
            <div className="absolute inset-0 backdrop-blur-[2px] bg-dark-surface/65 rounded-DEFAULT flex flex-col items-center justify-center p-3 text-center">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-accent flex items-center justify-center mb-1.5">
                <span className="material-symbols-outlined text-lg">lock</span>
              </div>
              <p className="text-label-md font-bold text-dark-on-surface text-xs">
                Desbloqueie os Alertas Preditivos por Padrão de Consumo
              </p>
              <p className="text-[10px] text-dark-on-surface-variant mb-2.5 max-w-[260px]">
                Veja em tempo real os dias e categorias com maior risco de microgastos no seu ciclo.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('plans')}
                className="px-4 py-2 rounded-DEFAULT bg-primary text-on-primary font-headline text-label-sm font-bold shadow-md shadow-primary/30 hover:bg-accent transition-colors"
              >
                Testar Premium por R$ 19,90/mês
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 3. RECURSO GRATUITO: Resumo de Hábitos Financeiros */}
      <section className="p-4 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-label-sm font-semibold text-dark-on-surface">
            Resumo de Hábitos Financeiros
          </span>
          <span className="px-2 py-0.5 rounded bg-dark-surface text-dark-on-surface-variant text-[9px] font-bold uppercase">
            Grátis
          </span>
        </div>
        <div className="flex items-center justify-between py-1 text-xs border-b border-dark-outline/40">
          <span className="text-dark-on-surface-variant">Dias sem furar o teto neste ciclo</span>
          <span className="text-success font-bold tabular-nums">{radar.daysWithinCeiling} dias</span>
        </div>
        <div className="flex items-center justify-between py-1 text-xs">
          <span className="text-dark-on-surface-variant">Economia estimada gerada</span>
          <span className="text-dark-on-surface font-bold tabular-nums whitespace-nowrap">
            {centsToBRL(radar.estimatedSavingsCents)}
          </span>
        </div>
      </section>
        </div>

        <div className="md:col-span-6 space-y-5 min-w-0">
      {/* 4. Distribuição por Categoria + Exportar CSV */}
      <section className="p-4 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-dark-on-surface">
            Despesas por Categoria no Ciclo
          </h3>
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-2.5 py-1 rounded bg-dark-surface border border-dark-outline text-[10px] font-semibold text-dark-on-surface hover:border-primary/50 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-xs">download</span>
            Exportar CSV
          </button>
        </div>

        {categoryBreakdown.length === 0 ? (
          <p className="text-[11px] text-dark-on-surface-variant py-2">
            Nenhuma despesa registrada neste ciclo para agrupar por categoria.
          </p>
        ) : (
          <div className="space-y-2">
            {categoryBreakdown.map((cat) => (
              <div key={cat.categoryId} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-dark-on-surface font-medium">
                    {cat.categoryName} ({cat.count})
                  </span>
                  <span className="text-dark-on-surface-variant tabular-nums whitespace-nowrap">
                    {centsToBRL(cat.totalCents)} ({Math.round(cat.percentage)}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-dark-surface overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, Math.round(cat.percentage))}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
        </div>
      </div>
    </StitchShell>
  );
}
