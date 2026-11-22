import { useMemo, useState, type FormEvent } from 'react';
import {
  calculateMicrospendingRadar,
  calculateReserveBalanceCents,
} from '../domain/ceilingEngine';
import {
  centsToBRL,
  centsToInputString,
  formatDateBR,
  getTodayISO,
  isValidISODate,
  parseCurrencyInputToCents,
} from '../domain/formatters';
import type {
  DailyCeilingResult,
  Goal,
  ReserveMovement,
  Transaction,
  WorkspaceState,
} from '../domain/types';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

interface GoalsReserveViewProps {
  state: WorkspaceState;
  ceiling: DailyCeilingResult;
  periodTransactions: Transaction[];
  referenceDate: string;
  onNavigate: (view: AppView) => void;
  onAddReserveMovement: (payload: {
    type: 'aporte' | 'resgate';
    amountCents: number;
    description: string;
    date: string;
    goalId?: string;
  }) => void;
  onRequestDeleteReserveMovement: (mov: ReserveMovement) => void;
  onCreateGoal: (payload: {
    title: string;
    targetCents: number;
    deadlineLabel: string;
    icon: string;
  }) => void;
  onContributeToGoal: (goalId: string, amountCents: number, alsoReserve: boolean) => void;
  onRequestDeleteGoal: (goal: Goal) => void;
  onUpdateReserveTarget: (targetCents: number) => void;
  toasts: ToastNotice[];
}

const GOAL_ICONS = [
  { id: 'flight_takeoff', label: 'Viagem' },
  { id: 'laptop_mac', label: 'Tech' },
  { id: 'school', label: 'Estudos' },
  { id: 'home', label: 'Casa' },
  { id: 'directions_car', label: 'Auto' },
  { id: 'savings', label: 'Reserva' },
];

export function GoalsReserveView({
  state,
  ceiling,
  periodTransactions,
  referenceDate,
  onNavigate,
  onAddReserveMovement,
  onRequestDeleteReserveMovement,
  onCreateGoal,
  onContributeToGoal,
  onRequestDeleteGoal,
  onUpdateReserveTarget,
  toasts,
}: GoalsReserveViewProps) {
  const [reserveModalType, setReserveModalType] = useState<'aporte' | 'resgate' | null>(null);
  const [reserveAmountInput, setReserveAmountInput] = useState('150,00');
  const [reserveDescInput, setReserveDescInput] = useState('');
  const [reserveDateInput, setReserveDateInput] = useState(getTodayISO());
  const [reserveError, setReserveError] = useState<string | null>(null);

  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTargetInput, setGoalTargetInput] = useState('2.000,00');
  const [goalDeadline, setGoalDeadline] = useState('Dezembro 2026');
  const [goalIcon, setGoalIcon] = useState('flight_takeoff');
  const [goalError, setGoalError] = useState<string | null>(null);

  const [targetEditOpen, setTargetEditOpen] = useState(false);
  const [emergencyTargetInput, setEmergencyTargetInput] = useState(
    centsToInputString(state.profile.emergencyReserveTargetCents)
  );
  const [targetError, setTargetError] = useState<string | null>(null);

  const [contributingGoal, setContributingGoal] = useState<Goal | null>(null);
  const [goalContributionInput, setGoalContributionInput] = useState('100,00');
  const [alsoReserveCheck, setAlsoReserveCheck] = useState(true);
  const [goalContribError, setGoalContribError] = useState<string | null>(null);

  const reserveBalanceCents = useMemo(
    () => calculateReserveBalanceCents(state.reserveMovements),
    [state.reserveMovements]
  );

  const radar = useMemo(
    () => calculateMicrospendingRadar(periodTransactions, state.categories, ceiling),
    [periodTransactions, state.categories, ceiling]
  );

  const targetCents = Math.max(100, state.profile.emergencyReserveTargetCents || 540000);
  const progressPct = Math.min(100, Math.round((reserveBalanceCents / targetCents) * 100));
  const missingCents = Math.max(0, targetCents - reserveBalanceCents);

  const parsedReserveAmount = parseCurrencyInputToCents(reserveAmountInput, true);
  const projectedFreeAfterReserve = useMemo(() => {
    const amt = parsedReserveAmount ?? 0;
    if (reserveModalType === 'aporte') return ceiling.availableToSpendCents - amt;
    if (reserveModalType === 'resgate') return ceiling.availableToSpendCents + amt;
    return ceiling.availableToSpendCents;
  }, [parsedReserveAmount, reserveModalType, ceiling.availableToSpendCents]);

  const weeklyLimitDays = Math.min(7, Math.max(0, radar.daysWithinCeiling));
  const weeklyPct = Math.round((weeklyLimitDays / 7) * 100);

  const sortedMovements = useMemo(
    () => [...state.reserveMovements].sort((a, b) => b.date.localeCompare(a.date)),
    [state.reserveMovements]
  );

  const openReserveModal = (kind: 'aporte' | 'resgate') => {
    setReserveModalType(kind);
    setReserveAmountInput(kind === 'aporte' ? '150,00' : '100,00');
    setReserveDescInput(
      kind === 'aporte' ? 'Aporte da Sobra do Teto' : 'Resgate da Reserva de Emergência'
    );
    setReserveDateInput(referenceDate || getTodayISO());
    setReserveError(null);
  };

  const handleReserveSubmit = (e: FormEvent) => {
    e.preventDefault();
    setReserveError(null);

    if (!parsedReserveAmount || parsedReserveAmount <= 0) {
      setReserveError('Informe um valor válido maior que R$ 0,00.');
      return;
    }
    if (!isValidISODate(reserveDateInput)) {
      setReserveError('Informe uma data válida.');
      return;
    }
    if (reserveModalType === 'resgate' && parsedReserveAmount > reserveBalanceCents) {
      setReserveError(
        `Saldo insuficiente na reserva. Disponível para resgate: ${centsToBRL(reserveBalanceCents)}.`
      );
      return;
    }

    const desc =
      reserveDescInput.trim() ||
      (reserveModalType === 'aporte' ? 'Aporte na Reserva' : 'Resgate da Reserva');

    onAddReserveMovement({
      type: reserveModalType ?? 'aporte',
      amountCents: parsedReserveAmount,
      description: desc,
      date: reserveDateInput,
    });
    setReserveModalType(null);
  };

  const handleCreateGoalSubmit = (e: FormEvent) => {
    e.preventDefault();
    setGoalError(null);

    const trimmed = goalTitle.trim();
    const target = parseCurrencyInputToCents(goalTargetInput, true);
    if (!trimmed) {
      setGoalError('Informe um título para o objetivo.');
      return;
    }
    if (!target || target <= 0) {
      setGoalError('Informe um valor alvo maior que R$ 0,00.');
      return;
    }

    onCreateGoal({
      title: trimmed,
      targetCents: target,
      deadlineLabel: goalDeadline.trim() || 'Sem prazo definido',
      icon: goalIcon,
    });
    setGoalTitle('');
    setGoalTargetInput('2.000,00');
    setNewGoalOpen(false);
  };

  const handleTargetEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTargetError(null);
    const parsed = parseCurrencyInputToCents(emergencyTargetInput, true);
    if (!parsed || parsed <= 0) {
      setTargetError('Informe um valor alvo válido maior que R$ 0,00.');
      return;
    }
    onUpdateReserveTarget(parsed);
    setTargetEditOpen(false);
  };

  const handleGoalContribSubmit = (e: FormEvent) => {
    e.preventDefault();
    setGoalContribError(null);
    if (!contributingGoal) return;
    const amt = parseCurrencyInputToCents(goalContributionInput, true);
    if (!amt || amt <= 0) {
      setGoalContribError('Informe um valor válido maior que R$ 0,00.');
      return;
    }
    onContributeToGoal(contributingGoal.id, amt, alsoReserveCheck);
    setContributingGoal(null);
  };

  return (
    <StitchShell
      activeView="goals"
      onNavigate={onNavigate}
      showBack
      backTo="dashboard"
      title="Metas & Reserva"
      subtitle="Metas & Reserva de Emergência"
      toasts={toasts}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('statement')}
            aria-label="Abrir Extrato"
            title="Extrato Completo"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-dark-surface-variant text-dark-on-surface-variant border border-dark-outline hover:text-dark-on-surface hover:border-primary/50 transition-colors"
          >
            <span className="material-symbols-outlined text-[19px]">receipt_long</span>
          </button>
          <span className="px-2.5 py-1 rounded-full bg-success/15 text-success border border-success/30 font-label text-label-sm font-semibold flex items-center gap-1 whitespace-nowrap">
            <span className="material-symbols-outlined text-xs">emoji_events</span>
            <span>Nível {state.profile.level}</span>
          </span>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        <div className="md:col-span-6 space-y-5 min-w-0">
      {/* Hero Card Reserva de Emergência */}
      <section className="p-5 sm:p-6 rounded-lg bg-gradient-to-b from-dark-surface-variant via-dark-surface-variant to-[#151B18] border border-dark-outline relative overflow-hidden shadow-lg">
        <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-success/10 blur-xl pointer-events-none" />

        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="text-label-md font-medium text-dark-on-surface-variant uppercase tracking-wider text-[11px]">
            Reserva de Emergência
          </span>
          <span className="text-label-sm text-success font-semibold flex items-center gap-1 whitespace-nowrap tabular-nums">
            <span className="material-symbols-outlined text-xs">trending_up</span>
            {ceiling.periodReserveNetCents >= 0 ? '+' : ''}
            {centsToBRL(ceiling.periodReserveNetCents)}/ciclo
          </span>
        </div>

        <div className="my-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-headline-md font-bold text-dark-on-surface-variant">R$</span>
            <span
              data-testid="reserve-balance-value"
              className="font-headline text-display-lg-mobile text-dark-on-surface font-extrabold tracking-tight tabular-nums whitespace-nowrap"
            >
              {new Intl.NumberFormat('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(reserveBalanceCents / 100)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <p className="text-body-sm text-dark-on-surface-variant text-xs">
              Meta estimada:{' '}
              <span className="text-dark-on-surface font-semibold tabular-nums whitespace-nowrap">
                {centsToBRL(targetCents)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setEmergencyTargetInput(centsToInputString(targetCents));
                setTargetError(null);
                setTargetEditOpen(true);
              }}
              aria-label="Editar meta da reserva de emergência"
              className="text-[10px] px-2 py-0.5 rounded bg-dark-surface border border-dark-outline text-dark-on-surface-variant hover:text-dark-on-surface"
            >
              Ajustar meta
            </button>
          </div>
        </div>

        {/* Progress Tracker */}
        <div className="space-y-1.5 my-4">
          <div className="h-2.5 w-full rounded-full bg-dark-surface border border-dark-outline/70 overflow-hidden p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-success/80 to-success transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-dark-on-surface-variant">
            <span>{progressPct}% da meta concluída</span>
            <span className="text-dark-on-surface font-medium tabular-nums whitespace-nowrap">
              {missingCents === 0 ? 'Meta atingida!' : `Faltam ${centsToBRL(missingCents)}`}
            </span>
          </div>
        </div>

        {/* Quick Contribution & Withdrawal Buttons */}
        <div className="pt-2 flex flex-col min-[380px]:flex-row items-stretch min-[380px]:items-center gap-2">
          <button
            type="button"
            onClick={() => openReserveModal('aporte')}
            className="flex-1 py-2.5 px-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline hover:border-success/50 text-dark-on-surface font-headline text-label-md font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-success text-base flex-shrink-0">add_circle</span>
            <span>Aportar da Sobra do Teto</span>
          </button>
          <button
            type="button"
            onClick={() => openReserveModal('resgate')}
            disabled={reserveBalanceCents <= 0}
            className="flex-shrink-0 py-2.5 px-3 rounded-DEFAULT bg-dark-surface border border-dark-outline hover:border-warning/50 disabled:opacity-45 text-dark-on-surface-variant hover:text-dark-on-surface font-headline text-label-md font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-warning text-base flex-shrink-0">remove_circle</span>
            <span>Resgatar</span>
          </button>
        </div>
      </section>

      {/* Recompensas por Hábitos */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-headline text-headline-sm text-dark-on-surface font-semibold">
            Recompensas por Hábitos
          </h3>
          <span className="text-[11px] text-accent font-semibold">Desafios Semanais</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <span className="w-8 h-8 rounded-full bg-primary-container text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-base">local_fire_department</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-primary/20 text-accent text-[9px] font-bold">
                {weeklyLimitDays >= 7 ? 'Concluído' : 'Ativo'}
              </span>
            </div>
            <div className="mt-3">
              <p className="text-label-md font-semibold text-dark-on-surface leading-tight">
                Semana no Limite
              </p>
              <p className="text-[11px] text-dark-on-surface-variant mt-0.5">
                {weeklyLimitDays}/7 dias dentro do teto
              </p>
              <div className="w-full bg-dark-surface h-1.5 rounded-full mt-2 overflow-hidden">
                <div className="bg-primary h-full rounded-full" style={{ width: `${weeklyPct}%` }} />
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <span className="w-8 h-8 rounded-full bg-success/20 text-success flex items-center justify-center">
                <span className="material-symbols-outlined text-base">military_tech</span>
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  !ceiling.isDeficit
                    ? 'bg-success/20 text-success'
                    : 'bg-warning/20 text-warning'
                }`}
              >
                {!ceiling.isDeficit ? 'No Azul' : 'Atenção'}
              </span>
            </div>
            <div className="mt-3">
              <p className="text-label-md font-semibold text-dark-on-surface leading-tight">
                Controle de Impulsos
              </p>
              <p className="text-[11px] text-dark-on-surface-variant mt-0.5">
                {radar.variableExpensesCount} gasto(s) livre(s) no ciclo
              </p>
              <div className="w-full bg-dark-surface h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-success h-full rounded-full"
                  style={{ width: ceiling.isDeficit ? '35%' : '100%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
        </div>

        <div className="md:col-span-6 space-y-5 min-w-0">
      {/* Objetivos Ativos */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-headline text-headline-sm text-dark-on-surface font-semibold">
            Objetivos Ativos
          </h3>
          <button
            type="button"
            onClick={() => {
              setGoalError(null);
              setNewGoalOpen(true);
            }}
            className="text-label-sm text-accent hover:underline flex items-center gap-1 font-semibold"
          >
            <span className="material-symbols-outlined text-xs">add</span> Criar Meta
          </button>
        </div>

        {state.goals.length === 0 ? (
          <div className="p-4 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-center space-y-2">
            <p className="text-xs font-semibold text-dark-on-surface">
              Nenhuma meta cadastrada ainda
            </p>
            <p className="text-[11px] text-dark-on-surface-variant">
              Crie um objetivo pessoal para acompanhar seu progresso junto com a reserva.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {state.goals.map((goal) => {
              const goalPct =
                goal.targetCents > 0
                  ? Math.min(100, Math.round((goal.savedCents / goal.targetCents) * 100))
                  : 0;
              const goalRemaining = Math.max(0, goal.targetCents - goal.savedCents);

              return (
                <article
                  key={goal.id}
                  className="p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-[#1E293B] text-primary flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-lg">
                          {goal.icon || 'flag'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-label-md font-semibold text-dark-on-surface truncate">
                          {goal.title}
                        </p>
                        <p className="text-body-sm text-dark-on-surface-variant text-[11px] tabular-nums">
                          {centsToBRL(goal.savedCents)} de {centsToBRL(goal.targetCents)} ({goalPct}%)
                          {goal.deadlineLabel ? ` • ${goal.deadlineLabel}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-label-sm text-dark-on-surface font-bold tabular-nums whitespace-nowrap">
                        {goalRemaining === 0 ? 'Concluída' : `Faltam ${centsToBRL(goalRemaining)}`}
                      </span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-dark-surface overflow-hidden">
                    <div
                      className="h-full bg-success rounded-full transition-all"
                      style={{ width: `${goalPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setContributingGoal(goal);
                        setGoalContributionInput('100,00');
                        setAlsoReserveCheck(true);
                        setGoalContribError(null);
                      }}
                      className="px-2.5 py-1 rounded bg-success/15 border border-success/30 text-success text-[11px] font-semibold hover:bg-success/25 transition-colors"
                    >
                      + Aportar na Meta
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteGoal(goal)}
                      aria-label={`Excluir meta "${goal.title}"`}
                      className="px-2 py-1 rounded text-[11px] text-dark-on-surface-variant hover:text-error transition-colors"
                    >
                      Remover
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Histórico de Movimentações da Reserva */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-headline text-headline-sm text-dark-on-surface font-semibold">
            Histórico da Reserva
          </h3>
          <span className="text-[11px] text-dark-on-surface-variant">
            {sortedMovements.length} registro(s)
          </span>
        </div>

        {sortedMovements.length === 0 ? (
          <div className="p-4 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-center text-[11px] text-dark-on-surface-variant">
            Nenhum aporte ou resgate registrado até o momento.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedMovements.map((mov) => {
              const isAporte = mov.type === 'aporte';
              return (
                <div
                  key={mov.id}
                  className="p-3 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-dark-on-surface truncate">
                      {mov.description}
                    </p>
                    <p className="text-[10px] text-dark-on-surface-variant">
                      {formatDateBR(mov.date)} • {isAporte ? 'Aporte' : 'Resgate'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                        isAporte ? 'text-success' : 'text-warning'
                      }`}
                    >
                      {isAporte ? '+ ' : '- '}
                      {centsToBRL(mov.amountCents)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteReserveMovement(mov)}
                      aria-label={`Excluir movimentação da reserva "${mov.description}"`}
                      className="w-7 h-7 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-error flex items-center justify-center"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
        </div>
      </div>

      {/* Modal: Criar Nova Meta */}
      {newGoalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-goal-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewGoalOpen(false);
          }}
        >
          <form
            onSubmit={handleCreateGoalSubmit}
            className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">flag</span>
                <h3
                  id="new-goal-modal-title"
                  className="font-headline text-headline-sm text-dark-on-surface font-bold"
                >
                  Nova Meta
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNewGoalOpen(false)}
                aria-label="Fechar modal nova meta"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {goalError && (
              <div role="alert" className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                {goalError}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <label htmlFor="goalTitleInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                  Título do Objetivo
                </label>
                <input
                  id="goalTitleInput"
                  type="text"
                  required
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="Ex: Reserva de Emergência Adicional"
                  className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="goalTargetInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                    Valor Alvo (R$)
                  </label>
                  <input
                    id="goalTargetInput"
                    type="text"
                    inputMode="decimal"
                    required
                    value={goalTargetInput}
                    onChange={(e) => setGoalTargetInput(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="goalDeadlineInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                    Prazo Estimado
                  </label>
                  <input
                    id="goalDeadlineInput"
                    type="text"
                    value={goalDeadline}
                    onChange={(e) => setGoalDeadline(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <span className="text-[11px] text-dark-on-surface-variant block mb-1">Ícone</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {GOAL_ICONS.map((ic) => (
                    <button
                      key={ic.id}
                      type="button"
                      onClick={() => setGoalIcon(ic.id)}
                      className={`py-1.5 px-2 rounded border text-[11px] flex items-center justify-center gap-1 ${
                        goalIcon === ic.id
                          ? 'bg-primary/20 border-primary text-dark-on-surface'
                          : 'bg-dark-surface border-dark-outline text-dark-on-surface-variant'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">{ic.id}</span>
                      <span>{ic.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewGoalOpen(false)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Salvar Meta
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Aporte / Resgate da Reserva */}
      {reserveModalType && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reserve-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReserveModalType(null);
          }}
        >
          <form
            onSubmit={handleReserveSubmit}
            className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`material-symbols-outlined text-xl ${
                    reserveModalType === 'aporte' ? 'text-success' : 'text-warning'
                  }`}
                >
                  savings
                </span>
                <h3
                  id="reserve-modal-title"
                  className="font-headline text-headline-sm text-dark-on-surface font-bold"
                >
                  {reserveModalType === 'aporte' ? 'Aportar na Reserva' : 'Resgatar da Reserva'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReserveModalType(null)}
                aria-label="Fechar modal da reserva"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <p className="text-xs text-dark-on-surface-variant leading-relaxed">
              {reserveModalType === 'aporte' ? (
                <>
                  Você possui{' '}
                  <strong className="text-accent tabular-nums">
                    {centsToBRL(ceiling.availableToSpendCents)}
                  </strong>{' '}
                  de teto livre restante. Quanto deseja transferir para sua reserva?
                </>
              ) : (
                <>
                  Seu saldo acumulado na reserva é{' '}
                  <strong className="text-success tabular-nums">
                    {centsToBRL(reserveBalanceCents)}
                  </strong>
                  . Quanto deseja resgatar para seu teto livre?
                </>
              )}
            </p>

            {reserveError && (
              <div role="alert" className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                {reserveError}
              </div>
            )}

            <div className="p-3 rounded bg-dark-surface border border-dark-outline text-center">
              <label htmlFor="reserveAmountInput" className="text-[11px] text-dark-on-surface-variant block">
                {reserveModalType === 'aporte' ? 'Valor do Aporte' : 'Valor do Resgate'}
              </label>
              <div className="flex items-baseline justify-center gap-1 my-1">
                <span
                  className={`font-bold text-base ${
                    reserveModalType === 'aporte' ? 'text-success' : 'text-warning'
                  }`}
                >
                  R$
                </span>
                <input
                  id="reserveAmountInput"
                  type="text"
                  inputMode="decimal"
                  required
                  value={reserveAmountInput}
                  onChange={(e) => {
                    setReserveAmountInput(e.target.value);
                    setReserveError(null);
                  }}
                  className="bg-transparent text-center font-bold text-2xl text-dark-on-surface w-36 focus:outline-none tabular-nums"
                />
              </div>
              <span className="text-[10px] text-dark-on-surface-variant tabular-nums">
                Seu teto livre passará a ser {centsToBRL(projectedFreeAfterReserve)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="reserveDescInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                  Descrição
                </label>
                <input
                  id="reserveDescInput"
                  type="text"
                  value={reserveDescInput}
                  onChange={(e) => setReserveDescInput(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="reserveDateInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                  Data
                </label>
                <input
                  id="reserveDateInput"
                  type="date"
                  value={reserveDateInput}
                  onChange={(e) => setReserveDateInput(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none tabular-nums"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReserveModalType(null)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={`flex-1 py-2.5 rounded-DEFAULT text-xs font-bold hover:opacity-90 ${
                  reserveModalType === 'aporte'
                    ? 'bg-success text-dark-surface'
                    : 'bg-warning text-on-warning'
                }`}
              >
                {reserveModalType === 'aporte' ? 'Confirmar Aporte' : 'Confirmar Resgate'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Aportar em Meta Específica */}
      {contributingGoal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="goal-contrib-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setContributingGoal(null);
          }}
        >
          <form
            onSubmit={handleGoalContribSubmit}
            className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 id="goal-contrib-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                Aportar em "{contributingGoal.title}"
              </h3>
              <button
                type="button"
                onClick={() => setContributingGoal(null)}
                aria-label="Fechar aporte de meta"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {goalContribError && (
              <div role="alert" className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                {goalContribError}
              </div>
            )}

            <div>
              <label htmlFor="goalContribInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                Valor do Aporte (R$)
              </label>
              <input
                id="goalContribInput"
                type="text"
                inputMode="decimal"
                required
                value={goalContributionInput}
                onChange={(e) => setGoalContributionInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded bg-dark-surface border border-dark-outline text-sm font-bold text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-dark-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={alsoReserveCheck}
                onChange={(e) => setAlsoReserveCheck(e.target.checked)}
                className="rounded border-dark-outline bg-dark-surface text-success focus:ring-success"
              />
              <span>Reservar do Teto Livre atual e somar na Reserva de Emergência</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setContributingGoal(null)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-DEFAULT bg-success text-dark-surface text-xs font-bold hover:opacity-90"
              >
                Confirmar Aporte
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Ajustar Meta da Reserva de Emergência */}
      {targetEditOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-emergency-target-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTargetEditOpen(false);
          }}
        >
          <form
            onSubmit={handleTargetEditSubmit}
            className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 id="edit-emergency-target-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                Meta da Reserva
              </h3>
              <button
                type="button"
                onClick={() => setTargetEditOpen(false)}
                aria-label="Fechar ajuste de meta da reserva"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {targetError && (
              <div role="alert" className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                {targetError}
              </div>
            )}

            <div>
              <label htmlFor="emergencyTargetInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                Valor Alvo da Reserva de Emergência (R$)
              </label>
              <input
                id="emergencyTargetInput"
                type="text"
                inputMode="decimal"
                required
                value={emergencyTargetInput}
                onChange={(e) => setEmergencyTargetInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded bg-dark-surface border border-dark-outline text-sm font-bold text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTargetEditOpen(false)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Salvar Meta
              </button>
            </div>
          </form>
        </div>
      )}
    </StitchShell>
  );
}
