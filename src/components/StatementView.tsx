import { useMemo, useState } from 'react';
import { resolveExpenseBudgetKind } from '../domain/ceilingEngine';
import { centsToBRL, formatDateBR, formatShortDateBR, isNonBusinessDay } from '../domain/formatters';
import type { RecurringRule, Transaction, WorkspaceState } from '../domain/types';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

interface StatementViewProps {
  state: WorkspaceState;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  allExpandedTransactions: Transaction[];
  periodTransactions: Transaction[];
  onNavigate: (view: AppView) => void;
  onEditTransaction: (tx: Transaction) => void;
  onToggleTransactionStatus: (tx: Transaction) => void;
  onRequestReverseTransaction: (tx: Transaction) => void;
  onRequestDeleteTransaction: (tx: Transaction) => void;
  onToggleRecurringRule: (ruleId: string) => void;
  onRequestDeleteRecurringRule: (rule: RecurringRule) => void;
  toasts: ToastNotice[];
}

type StatementTab = 'periodo' | 'todas' | 'recorrencias';

export function StatementView({
  state,
  periodLabel,
  periodStart,
  periodEnd,
  allExpandedTransactions,
  periodTransactions,
  onNavigate,
  onEditTransaction,
  onToggleTransactionStatus,
  onRequestReverseTransaction,
  onRequestDeleteTransaction,
  onToggleRecurringRule,
  onRequestDeleteRecurringRule,
  toasts,
}: StatementViewProps) {
  const [activeTab, setActiveTab] = useState<StatementTab>('periodo');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'todos' | 'receita' | 'despesa'>('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'pago' | 'pendente' | 'cancelado'>('todos');
  const [categoryFilter, setCategoryFilter] = useState<string>('todas');

  const sourceList = activeTab === 'periodo' ? periodTransactions : allExpandedTransactions;

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sourceList.filter((tx) => {
      if (typeFilter !== 'todos' && tx.type !== typeFilter) return false;
      if (statusFilter !== 'todos' && tx.status !== statusFilter) return false;
      if (categoryFilter !== 'todas' && tx.categoryId !== categoryFilter) return false;
      if (q) {
        const catName =
          state.categories.find((c) => c.id === tx.categoryId)?.name.toLowerCase() ?? '';
        if (!tx.description.toLowerCase().includes(q) && !catName.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [sourceList, typeFilter, statusFilter, categoryFilter, searchQuery, state.categories]);

  const summary = useMemo(() => {
    let rev = 0;
    let fixedExp = 0;
    let livreExp = 0;
    for (const tx of filteredList) {
      if (tx.status === 'cancelado' || tx.isReversal) continue;
      if (tx.type === 'receita') rev += tx.amountCents;
      else if (resolveExpenseBudgetKind(tx, state.categories) === 'fixo') fixedExp += tx.amountCents;
      else livreExp += tx.amountCents;
    }
    return { rev, fixedExp, livreExp };
  }, [filteredList, state.categories]);

  return (
    <StitchShell
      activeView="statement"
      onNavigate={onNavigate}
      showBack
      backTo="dashboard"
      title="Extrato Completo"
      subtitle={`${periodLabel} • ${formatShortDateBR(periodStart)} a ${formatShortDateBR(periodEnd)}`}
      toasts={toasts}
      headerRight={
        <button
          type="button"
          onClick={() => onNavigate('quick-record')}
          className="md:hidden px-3 py-1.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent transition-colors flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          <span>Novo</span>
        </button>
      }
    >
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Visualização do extrato"
        className="grid grid-cols-3 gap-1 p-1 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline"
      >
        {(
          [
            { id: 'periodo', label: 'Período' },
            { id: 'todas', label: 'Todas & Futuras' },
            { id: 'recorrencias', label: 'Recorrências' },
          ] as Array<{ id: StatementTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-2 px-1.5 rounded text-[11px] font-semibold transition-colors truncate ${
              activeTab === tab.id
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-dark-on-surface-variant hover:text-dark-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'recorrencias' ? (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-dark-on-surface">
              Regras Recorrentes ({state.recurringRules.length})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('quick-record')}
              className="text-[11px] text-accent font-semibold hover:underline"
            >
              + Nova recorrência
            </button>
          </div>

          {state.recurringRules.length === 0 ? (
            <div className="p-5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-center space-y-2">
              <p className="text-xs font-semibold text-dark-on-surface">
                Nenhuma regra recorrente cadastrada
              </p>
              <p className="text-[11px] text-dark-on-surface-variant">
                Cadastre salários, aluguel ou assinaturas no modo Recorrente pelo botão +.
              </p>
            </div>
          ) : (
            state.recurringRules.map((rule) => {
              const cat = state.categories.find((c) => c.id === rule.categoryId);
              const isRev = rule.type === 'receita';
              return (
                <article
                  key={rule.id}
                  className={`p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline space-y-2 ${
                    !rule.active ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-dark-on-surface truncate">
                        {rule.description}
                      </p>
                      <p className="text-[11px] text-dark-on-surface-variant">
                        {cat?.name ?? 'Geral'} • {rule.frequency}
                        {rule.type === 'despesa' && rule.budgetKind ? ` • ${rule.budgetKind}` : ''} • Início {formatDateBR(rule.startDate)}
                        {rule.endDate ? ` até ${formatDateBR(rule.endDate)}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                        isRev ? 'text-success' : 'text-accent'
                      }`}
                    >
                      {isRev ? '+ ' : '- '}
                      {centsToBRL(rule.amountCents)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-dark-outline/50">
                    <button
                      type="button"
                      onClick={() => onToggleRecurringRule(rule.id)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                        rule.active
                          ? 'bg-success/15 border-success/30 text-success'
                          : 'bg-dark-surface border-dark-outline text-dark-on-surface-variant'
                      }`}
                    >
                      {rule.active ? 'Ativa (Pausar)' : 'Pausada (Reativar)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteRecurringRule(rule)}
                      aria-label={`Excluir recorrência "${rule.description}"`}
                      className="px-2.5 py-1 rounded text-[11px] text-error hover:bg-error/10 font-semibold"
                    >
                      Excluir regra
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : (
        <>
          {/* Filtros */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="search"
                aria-label="Buscar movimentações no extrato"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por descrição ou categoria..."
                className="flex-1 px-3.5 py-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-xs text-dark-on-surface placeholder-dark-on-surface-variant focus:border-primary focus:outline-none"
              />
              {(searchQuery ||
                typeFilter !== 'todos' ||
                statusFilter !== 'todos' ||
                categoryFilter !== 'todas') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setTypeFilter('todos');
                    setStatusFilter('todos');
                    setCategoryFilter('todas');
                  }}
                  className="px-2.5 py-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] font-semibold text-accent hover:border-primary/50 whitespace-nowrap"
                >
                  Limpar filtros
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                aria-label="Filtrar por tipo"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as 'todos' | 'receita' | 'despesa')
                }
                className="px-2.5 py-2 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] text-dark-on-surface focus:border-primary focus:outline-none"
              >
                <option value="todos">Todos tipos</option>
                <option value="receita">Receitas</option>
                <option value="despesa">Despesas</option>
              </select>
              <select
                aria-label="Filtrar por status"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as 'todos' | 'pago' | 'pendente' | 'cancelado'
                  )
                }
                className="px-2.5 py-2 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] text-dark-on-surface focus:border-primary focus:outline-none"
              >
                <option value="todos">Todos status</option>
                <option value="pago">Pago / Recebido</option>
                <option value="pendente">Pendente</option>
                <option value="cancelado">Cancelado</option>
              </select>
              <select
                aria-label="Filtrar por categoria"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-2.5 py-2 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] text-dark-on-surface focus:border-primary focus:outline-none"
              >
                <option value="todas">Categorias</option>
                {state.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Resumo filtrado */}
          <section className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline">
              <p className="text-[10px] text-dark-on-surface-variant">Receitas</p>
              <p className="text-xs font-bold text-success tabular-nums whitespace-nowrap">
                {centsToBRL(summary.rev)}
              </p>
            </div>
            <div className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline">
              <p className="text-[10px] text-dark-on-surface-variant">Fixos</p>
              <p className="text-xs font-bold text-warning tabular-nums whitespace-nowrap">
                {centsToBRL(summary.fixedExp)}
              </p>
            </div>
            <div className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline">
              <p className="text-[10px] text-dark-on-surface-variant">Livres</p>
              <p className="text-xs font-bold text-accent tabular-nums whitespace-nowrap">
                {centsToBRL(summary.livreExp)}
              </p>
            </div>
          </section>

          {/* Lista de movimentações */}
          <section className="space-y-2.5">
            {filteredList.length === 0 ? (
              <div className="p-6 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-center space-y-2">
                <p className="text-xs font-semibold text-dark-on-surface">
                  Nenhuma movimentação encontrada
                </p>
                <p className="text-[11px] text-dark-on-surface-variant">
                  Ajuste os filtros ou registre um novo lançamento pelo botão +.
                </p>
              </div>
            ) : (
              filteredList.map((tx) => {
                const cat = state.categories.find((c) => c.id === tx.categoryId);
                const isRev = tx.type === 'receita';
                const isCancelled = tx.status === 'cancelado';
                const kind = isRev ? null : resolveExpenseBudgetKind(tx, state.categories);
                const nonBusiness = isNonBusinessDay(tx.date);

                return (
                  <article
                    key={tx.id}
                    className={`p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline space-y-2 ${
                      isCancelled ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className={`text-xs font-semibold text-dark-on-surface truncate ${
                            isCancelled ? 'line-through' : ''
                          }`}
                        >
                          {tx.description}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[10px] text-dark-on-surface-variant">
                          <span>
                            {formatDateBR(tx.date)} • {cat?.name ?? 'Geral'}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-dark-surface border border-dark-outline">
                            {isRev ? 'Receita' : kind === 'fixo' ? 'Fixo' : 'Livre'}
                          </span>
                          {tx.isVirtualRecurring && (
                            <span className="px-1.5 py-0.2 rounded bg-primary/15 text-accent">
                              Recorrente
                            </span>
                          )}
                          {tx.isReversal && (
                            <span className="px-1.5 py-0.2 rounded bg-warning/15 text-warning">
                              Estorno vinculado
                            </span>
                          )}
                          {tx.reversedById && !tx.isReversal && (
                            <span className="px-1.5 py-0.2 rounded bg-dark-surface border border-dark-outline text-dark-on-surface-variant">
                              Estornado
                            </span>
                          )}
                          {nonBusiness && (
                            <span className="px-1.5 py-0.2 rounded bg-warning/15 text-warning">
                              Dia não útil
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <p
                          className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                            isCancelled
                              ? 'text-dark-on-surface-variant'
                              : isRev
                              ? 'text-success'
                              : 'text-dark-on-surface'
                          }`}
                        >
                          {isRev ? '+ ' : '- '}
                          {centsToBRL(tx.amountCents)}
                        </p>
                        <span className="text-[10px] text-dark-on-surface-variant capitalize">
                          {isRev && tx.status === 'pago' ? 'Recebido' : tx.status}
                        </span>
                      </div>
                    </div>

                    {!tx.isReversal && !isCancelled && (
                      <div className="flex items-center justify-between flex-wrap gap-1.5 pt-2 border-t border-dark-outline/50">
                        <button
                          type="button"
                          onClick={() => onToggleTransactionStatus(tx)}
                          className={`px-2 py-1 rounded text-[10px] font-semibold border whitespace-nowrap ${
                            tx.status === 'pago'
                              ? 'bg-success/15 border-success/30 text-success'
                              : 'bg-warning/15 border-warning/30 text-warning'
                          }`}
                        >
                          {isRev
                            ? tx.status === 'pago'
                              ? 'Recebido (Alternar)'
                              : 'Pendente (Receber)'
                            : tx.status === 'pago'
                            ? 'Pago (Alternar)'
                            : 'Pendente (Pagar)'}
                        </button>

                        <div className="flex items-center flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            aria-label={`Editar "${tx.description}"`}
                            className="px-2 py-1 rounded bg-dark-surface border border-dark-outline text-[10px] text-dark-on-surface hover:border-primary/50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => onRequestReverseTransaction(tx)}
                            aria-label={`Estornar "${tx.description}"`}
                            className="px-2 py-1 rounded bg-dark-surface border border-dark-outline text-[10px] text-warning hover:border-warning/50"
                          >
                            Estornar
                          </button>
                          <button
                            type="button"
                            onClick={() => onRequestDeleteTransaction(tx)}
                            aria-label={`Excluir "${tx.description}"`}
                            className="px-2 py-1 rounded bg-dark-surface border border-dark-outline text-[10px] text-error hover:border-error/50"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </section>
        </>
      )}
    </StitchShell>
  );
}
