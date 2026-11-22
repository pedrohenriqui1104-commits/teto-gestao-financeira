import { useCallback, useEffect, useMemo, useState } from 'react';
import { AiChatView } from './components/AiChatView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DashboardView } from './components/DashboardView';
import { GoalsReserveView } from './components/GoalsReserveView';
import { LoginView } from './components/LoginView';
import { PlansView } from './components/PlansView';
import { ProfileView } from './components/ProfileView';
import { QuickRecordView, type QuickRecordDraft } from './components/QuickRecordView';
import { ReportsView } from './components/ReportsView';
import { StatementView } from './components/StatementView';
import type { AppView, ToastNotice } from './components/StitchShell';
import {
  calculateDailyCeiling,
  createReversalPair,
  expandTransactionsThroughDate,
  resolveExpenseBudgetKind,
  sortTransactions,
} from './domain/ceilingEngine';
import {
  addMonthsISO,
  centsToBRL,
  getPeriodRangeForReference,
  getTodayISO,
} from './domain/formatters';
import type {
  AppSession,
  ExpenseBudgetKind,
  Goal,
  LocalAccount,
  PlanTier,
  RecurringRule,
  ReserveMovement,
  Transaction,
  TransactionType,
  WorkspaceState,
} from './domain/types';
import {
  authenticateLocalAccount,
  clearSession,
  financialRepository,
  loadAccounts,
  loadSession,
  registerLocalAccount,
  saveSession,
} from './storage/repository';

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  tone: 'danger' | 'warning';
  action: () => void;
}

function getInitialAuth(): {
  accounts: LocalAccount[];
  session: AppSession | null;
  workspace: WorkspaceState | null;
  storageWarning: string | null;
} {
  const accounts = loadAccounts();
  let session = loadSession();

  if (!session && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const demo = accounts.find((a) => a.id === 'demo-lucas' && a.isDemo) ?? accounts.find((a) => a.isDemo);
      if (demo) {
        session = {
          accountId: demo.id,
          rememberMe: true,
          authenticatedAt: new Date().toISOString(),
        };
        saveSession(session);
      }
    }
  }

  if (session) {
    const exists = accounts.some((a) => a.id === session!.accountId);
    if (exists) {
      const loadRes = financialRepository.loadForAccountSafe(session.accountId);
      return {
        accounts,
        session,
        workspace: loadRes.workspace,
        storageWarning: loadRes.ok ? null : (loadRes.error ?? 'Erro ao carregar dados locais.'),
      };
    }
    clearSession();
  }

  return {
    accounts,
    session: null,
    workspace: null,
    storageWarning: null,
  };
}

export default function App() {
  const initialAuth = useMemo(() => getInitialAuth(), []);

  const [accounts, setAccounts] = useState<LocalAccount[]>(initialAuth.accounts);
  const [session, setSession] = useState<AppSession | null>(initialAuth.session);
  const [state, setState] = useState<WorkspaceState | null>(initialAuth.workspace);

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [monthOffset, setMonthOffset] = useState(0);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [quickRecordDraft, setQuickRecordDraft] = useState<QuickRecordDraft | null>(null);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const referenceDate = getTodayISO();

  const notifyToast = useCallback((message: string, tone: ToastNotice['tone'] = 'success') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3400);
  }, []);

  useEffect(() => {
    if (initialAuth.storageWarning) {
      notifyToast(initialAuth.storageWarning, 'warning');
    }
  }, [initialAuth.storageWarning, notifyToast]);

  useEffect(() => {
    if (session && state) {
      const res = financialRepository.saveForAccount(session.accountId, state);
      if (!res.ok && res.error) {
        notifyToast(res.error, 'error');
      }
    }
  }, [notifyToast, session, state]);

  const updateState = useCallback((updater: (prev: WorkspaceState) => WorkspaceState) => {
    setState((prev) => {
      if (!prev) return prev;
      return updater(prev);
    });
  }, []);

  const cycleClosingDay = state?.settings.cycleClosingDay ?? 0;

  const { start: periodStart, end: periodEnd, label: periodLabel } = useMemo(
    () => getPeriodRangeForReference(referenceDate, monthOffset, cycleClosingDay),
    [referenceDate, monthOffset, cycleClosingDay]
  );

  const ceiling = useMemo(() => {
    if (!state) return null;
    return calculateDailyCeiling(state, periodStart, periodEnd, referenceDate);
  }, [state, periodStart, periodEnd, referenceDate]);

  const allExpandedTransactions = useMemo(() => {
    if (!state) return [];
    const horizon = addMonthsISO(periodEnd, 12);
    return sortTransactions(expandTransactionsThroughDate(state, horizon));
  }, [state, periodEnd]);

  const periodTransactions = useMemo(
    () =>
      allExpandedTransactions.filter(
        (tx) => tx.date >= periodStart && tx.date <= periodEnd
      ),
    [allExpandedTransactions, periodStart, periodEnd]
  );

  const handleNavigate = useCallback((nextView: AppView) => {
    if (nextView !== 'quick-record') {
      setEditingTransaction(null);
      setQuickRecordDraft(null);
    }
    setActiveView(nextView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Auth handlers
  const handleAuthenticate = useCallback(
    async (email: string, password: string, rememberMe: boolean) => {
      const result = await authenticateLocalAccount(email, password);
      if (!result.ok) {
        return { ok: false as const, error: result.error };
      }
      const nextSession: AppSession = {
        accountId: result.account.id,
        rememberMe,
        authenticatedAt: new Date().toISOString(),
      };
      const sessionRes = saveSession(nextSession);
      if (!sessionRes.ok && sessionRes.error) {
        notifyToast(sessionRes.error, 'warning');
      }
      const loadRes = financialRepository.loadForAccountSafe(result.account.id);
      setAccounts(loadAccounts());
      setSession(nextSession);
      setState(loadRes.workspace);
      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setMonthOffset(0);
      setActiveView('dashboard');
      if (!loadRes.ok && loadRes.error) {
        notifyToast(loadRes.error, 'warning');
      } else {
        notifyToast(`Bem-vindo, ${result.account.name.split(' ')[0]}!`);
      }
      return { ok: true as const };
    },
    [notifyToast]
  );

  const handleQuickDemoLogin = useCallback(
    (accountId: string, rememberMe: boolean) => {
      const loadedAccounts = loadAccounts();
      const target = loadedAccounts.find((a) => a.id === accountId && a.isDemo);
      if (!target) {
        notifyToast('Acesso rápido com 1 clique está disponível apenas para perfis demo.', 'error');
        return;
      }

      const nextSession: AppSession = {
        accountId: target.id,
        rememberMe,
        authenticatedAt: new Date().toISOString(),
      };
      const sessionRes = saveSession(nextSession);
      if (!sessionRes.ok && sessionRes.error) {
        notifyToast(sessionRes.error, 'warning');
      }
      const loadRes = financialRepository.loadForAccountSafe(target.id);
      setAccounts(loadedAccounts);
      setSession(nextSession);
      setState(loadRes.workspace);
      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setMonthOffset(0);
      setActiveView('dashboard');
      notifyToast(`Acesso rápido ativado: ${target.name}`);
    },
    [notifyToast]
  );

  const handleRegister = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const result = await registerLocalAccount(input);
      if (!result.ok) {
        return { ok: false as const, error: result.error };
      }
      const nextSession: AppSession = {
        accountId: result.account.id,
        rememberMe: true,
        authenticatedAt: new Date().toISOString(),
      };
      saveSession(nextSession);
      setAccounts(loadAccounts());
      setSession(nextSession);
      setState(result.workspace);
      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setMonthOffset(0);
      setActiveView('dashboard');
      notifyToast('Conta criada localmente com sucesso!');
      return { ok: true as const };
    },
    [notifyToast]
  );

  // Materialize a virtual recurring transaction into state.transactions when edited/toggled/reversed
  const materializeOrUpdateTransaction = useCallback(
    (prev: WorkspaceState, tx: Transaction, patch: Partial<Transaction>): Transaction[] => {
      if (tx.isVirtualRecurring && tx.occurrenceKey) {
        const materialized: Transaction = {
          ...tx,
          ...patch,
          id: `tx_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          isVirtualRecurring: false,
        };
        return [...prev.transactions, materialized];
      }
      return prev.transactions.map((item) =>
        item.id === tx.id ? { ...item, ...patch } : item
      );
    },
    []
  );

  // QuickRecord handlers
  const handleSaveSingleOrEdit = useCallback(
    (payload: {
      editingId?: string;
      type: TransactionType;
      description: string;
      amountCents: number;
      date: string;
      categoryId: string;
      budgetKind?: ExpenseBudgetKind;
      status: 'pago' | 'pendente';
      paymentMethodLabel?: string;
      notes?: string;
      applyToPendingGroup?: boolean;
    }) => {
      const nowIso = new Date().toISOString();

      updateState((prev) => {
        if (payload.editingId && editingTransaction?.isVirtualRecurring && editingTransaction.occurrenceKey) {
          const materialized: Transaction = {
            ...editingTransaction,
            id: `tx_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: payload.type,
            description: payload.description,
            amountCents: payload.amountCents,
            date: payload.date,
            categoryId: payload.categoryId,
            budgetKind: payload.type === 'despesa' ? payload.budgetKind : undefined,
            status: payload.status,
            paymentMethodLabel: payload.paymentMethodLabel,
            notes: payload.notes,
            isVirtualRecurring: false,
          };
          return {
            ...prev,
            isDemoData: false,
            transactions: [...prev.transactions, materialized],
          };
        }

        if (payload.editingId) {
          const groupId = editingTransaction?.installmentGroupId;
          const baseTitle = payload.description.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
          return {
            ...prev,
            isDemoData: false,
            transactions: prev.transactions.map((tx) => {
              if (tx.id === payload.editingId) {
                return {
                  ...tx,
                  type: payload.type,
                  description: payload.description,
                  amountCents: payload.amountCents,
                  date: payload.date,
                  categoryId: payload.categoryId,
                  budgetKind: payload.type === 'despesa' ? payload.budgetKind : undefined,
                  status: payload.status,
                  paymentMethodLabel: payload.paymentMethodLabel,
                  notes: payload.notes,
                };
              }
              if (
                payload.applyToPendingGroup &&
                groupId &&
                tx.installmentGroupId === groupId &&
                tx.status === 'pendente'
              ) {
                const suffix =
                  tx.installmentNumber && tx.totalInstallments
                    ? ` (${tx.installmentNumber}/${tx.totalInstallments})`
                    : '';
                return {
                  ...tx,
                  description: baseTitle ? `${baseTitle}${suffix}` : tx.description,
                  categoryId: payload.categoryId,
                  budgetKind: payload.type === 'despesa' ? payload.budgetKind : tx.budgetKind,
                };
              }
              return tx;
            }),
          };
        }

        const created: Transaction = {
          id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: payload.type,
          description: payload.description,
          amountCents: payload.amountCents,
          date: payload.date,
          categoryId: payload.categoryId,
          status: payload.status,
          budgetKind: payload.type === 'despesa' ? payload.budgetKind : undefined,
          paymentMethodLabel: payload.paymentMethodLabel,
          notes: payload.notes,
          createdAt: nowIso,
        };

        return {
          ...prev,
          isDemoData: false,
          transactions: [created, ...prev.transactions],
        };
      });

      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setActiveView('dashboard');
      notifyToast(
        payload.editingId
          ? 'Movimentação atualizada e teto recalculado!'
          : `${payload.type === 'receita' ? 'Receita' : 'Despesa'} registrada e teto atualizado!`
      );
    },
    [editingTransaction, notifyToast, updateState]
  );

  const handleSaveInstallments = useCallback(
    (installments: Transaction[]) => {
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        transactions: [...installments, ...prev.transactions],
      }));
      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setActiveView('dashboard');
      notifyToast(`Compra parcelada em ${installments.length}x registrada!`);
    },
    [notifyToast, updateState]
  );

  const handleSaveRecurringRule = useCallback(
    (ruleInput: Omit<RecurringRule, 'id' | 'createdAt'>) => {
      const rule: RecurringRule = {
        ...ruleInput,
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      };
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        recurringRules: [rule, ...prev.recurringRules],
      }));
      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setActiveView('dashboard');
      notifyToast('Recorrência criada e aplicada ao período!');
    },
    [notifyToast, updateState]
  );

  const handleRequestDeleteTransaction = useCallback(
    (tx: Transaction) => {
      setPendingConfirm({
        title: tx.occurrenceKey ? 'Excluir ocorrência recorrente' : 'Excluir movimentação',
        description: tx.occurrenceKey
          ? `Deseja remover apenas esta ocorrência de "${tx.description}" (${centsToBRL(
              tx.amountCents
            )}) deste ciclo? As demais ocorrências futuras serão preservadas.`
          : `Tem certeza que deseja excluir "${tx.description}" (${centsToBRL(
              tx.amountCents
            )})? O teto diário será recalculado automaticamente.`,
        confirmLabel: 'Excluir',
        tone: 'danger',
        action: () => {
          updateState((prev) => {
            const skipped =
              tx.occurrenceKey && !prev.skippedOccurrenceKeys.includes(tx.occurrenceKey)
                ? [...prev.skippedOccurrenceKeys, tx.occurrenceKey]
                : prev.skippedOccurrenceKeys;

            return {
              ...prev,
              isDemoData: false,
              skippedOccurrenceKeys: skipped,
              transactions: tx.isVirtualRecurring
                ? prev.transactions
                : prev.transactions.filter((item) => item.id !== tx.id),
            };
          });
          setEditingTransaction(null);
          if (activeView === 'quick-record') {
            setActiveView('dashboard');
          }
          notifyToast('Movimentação removida e teto recalculado.');
        },
      });
    },
    [activeView, notifyToast, updateState]
  );

  const handleRequestDeleteInstallmentGroup = useCallback(
    (groupId: string, label: string) => {
      setPendingConfirm({
        title: 'Excluir parcelamento completo',
        description: `Deseja remover todas as parcelas de "${label}" que não foram estornadas? O teto dos ciclos afetados será recalculado.`,
        confirmLabel: 'Excluir Parcelamento',
        tone: 'danger',
        action: () => {
          updateState((prev) => ({
            ...prev,
            isDemoData: false,
            transactions: prev.transactions.filter((item) => item.installmentGroupId !== groupId),
          }));
          setEditingTransaction(null);
          if (activeView === 'quick-record') {
            setActiveView('dashboard');
          }
          notifyToast('Parcelamento removido e teto recalculado.');
        },
      });
    },
    [activeView, notifyToast, updateState]
  );

  const handleToggleTransactionStatus = useCallback(
    (tx: Transaction) => {
      if (tx.status === 'cancelado') return;
      const nextStatus: 'pago' | 'pendente' = tx.status === 'pago' ? 'pendente' : 'pago';
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        transactions: materializeOrUpdateTransaction(prev, tx, { status: nextStatus }),
      }));
      notifyToast(
        nextStatus === 'pago' ? 'Marcado como pago/recebido.' : 'Marcado como pendente.'
      );
    },
    [materializeOrUpdateTransaction, notifyToast, updateState]
  );

  const handleRequestReverseTransaction = useCallback(
    (tx: Transaction) => {
      if (tx.status === 'cancelado' || tx.isReversal) return;
      setPendingConfirm({
        title: 'Estornar lançamento',
        description: `Ao estornar "${tx.description}" (${centsToBRL(
          tx.amountCents
        )}), o registro será cancelado e um lançamento de estorno ficará registrado no histórico para auditoria.`,
        confirmLabel: 'Confirmar Estorno',
        tone: 'warning',
        action: () => {
          updateState((prev) => {
            const baseTx: Transaction =
              tx.isVirtualRecurring && tx.occurrenceKey
                ? {
                    ...tx,
                    id: `tx_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    isVirtualRecurring: false,
                  }
                : tx;
            const { updatedOriginal, reversalEntry } = createReversalPair(
              baseTx,
              referenceDate,
              'Estorno solicitado no extrato'
            );
            const updatedList = tx.isVirtualRecurring
              ? [...prev.transactions, updatedOriginal, reversalEntry]
              : [
                  ...prev.transactions.map((item) =>
                    item.id === baseTx.id ? updatedOriginal : item
                  ),
                  reversalEntry,
                ];
            return {
              ...prev,
              isDemoData: false,
              transactions: updatedList,
            };
          });
          notifyToast('Movimentação estornada com registro no extrato.');
        },
      });
    },
    [notifyToast, referenceDate, updateState]
  );

  const handleToggleRecurringRule = useCallback(
    (ruleId: string) => {
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        recurringRules: prev.recurringRules.map((rule) =>
          rule.id === ruleId ? { ...rule, active: !rule.active } : rule
        ),
      }));
      notifyToast('Status da recorrência atualizado.');
    },
    [notifyToast, updateState]
  );

  const handleRequestDeleteRecurringRule = useCallback(
    (rule: RecurringRule) => {
      setPendingConfirm({
        title: 'Excluir regra recorrente',
        description: `Deseja excluir a recorrência "${rule.description}"? As ocorrências futuras deixarão de ser projetadas.`,
        confirmLabel: 'Excluir Regra',
        tone: 'danger',
        action: () => {
          updateState((prev) => ({
            ...prev,
            isDemoData: false,
            recurringRules: prev.recurringRules.filter((r) => r.id !== rule.id),
          }));
          notifyToast('Regra recorrente excluída.');
        },
      });
    },
    [notifyToast, updateState]
  );

  // Goals & Reserve handlers
  const handleAddReserveMovement = useCallback(
    (payload: {
      type: 'aporte' | 'resgate';
      amountCents: number;
      description: string;
      date: string;
      goalId?: string;
    }) => {
      const mov: ReserveMovement = {
        id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: payload.type,
        amountCents: payload.amountCents,
        description: payload.description,
        date: payload.date,
        goalId: payload.goalId,
        createdAt: new Date().toISOString(),
      };
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        reserveMovements: [mov, ...prev.reserveMovements],
      }));
      notifyToast(
        payload.type === 'aporte'
          ? `Aporte de ${centsToBRL(payload.amountCents)} adicionado à reserva!`
          : `Resgate de ${centsToBRL(payload.amountCents)} devolvido ao teto!`
      );
    },
    [notifyToast, updateState]
  );

  const handleRequestDeleteReserveMovement = useCallback(
    (mov: ReserveMovement) => {
      setPendingConfirm({
        title: 'Remover movimentação da reserva',
        description: `Deseja excluir "${mov.description}" (${centsToBRL(mov.amountCents)}) do histórico da reserva?`,
        confirmLabel: 'Remover',
        tone: 'danger',
        action: () => {
          updateState((prev) => ({
            ...prev,
            isDemoData: false,
            reserveMovements: prev.reserveMovements.filter((m) => m.id !== mov.id),
          }));
          notifyToast('Movimentação da reserva removida.');
        },
      });
    },
    [notifyToast, updateState]
  );

  const handleCreateGoal = useCallback(
    (payload: { title: string; targetCents: number; deadlineLabel: string; icon: string }) => {
      const newGoal: Goal = {
        id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: payload.title,
        targetCents: payload.targetCents,
        savedCents: 0,
        deadlineLabel: payload.deadlineLabel,
        icon: payload.icon,
        createdAt: new Date().toISOString(),
      };
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        goals: [newGoal, ...prev.goals],
      }));
      notifyToast(`Meta "${payload.title}" criada!`);
    },
    [notifyToast, updateState]
  );

  const handleContributeToGoal = useCallback(
    (goalId: string, amountCents: number, alsoReserve: boolean) => {
      updateState((prev) => {
        const targetGoal = prev.goals.find((g) => g.id === goalId);
        const updatedGoals = prev.goals.map((g) =>
          g.id === goalId ? { ...g, savedCents: g.savedCents + amountCents } : g
        );
        const nextReserveMovements =
          alsoReserve && targetGoal
            ? [
                {
                  id: `res_goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  type: 'aporte' as const,
                  amountCents,
                  date: referenceDate,
                  description: `Aporte Meta: ${targetGoal.title}`,
                  goalId,
                  createdAt: new Date().toISOString(),
                },
                ...prev.reserveMovements,
              ]
            : prev.reserveMovements;

        return {
          ...prev,
          isDemoData: false,
          goals: updatedGoals,
          reserveMovements: nextReserveMovements,
        };
      });
      notifyToast(`+${centsToBRL(amountCents)} aportados na meta!`);
    },
    [notifyToast, referenceDate, updateState]
  );

  const handleRequestDeleteGoal = useCallback(
    (goal: Goal) => {
      setPendingConfirm({
        title: 'Excluir meta financeira',
        description: `Deseja excluir a meta "${goal.title}"? Os aportes já lançados na reserva geral permanecerão intactos.`,
        confirmLabel: 'Excluir Meta',
        tone: 'danger',
        action: () => {
          updateState((prev) => ({
            ...prev,
            isDemoData: false,
            goals: prev.goals.filter((g) => g.id !== goal.id),
          }));
          notifyToast('Meta excluída.');
        },
      });
    },
    [notifyToast, updateState]
  );

  const handleUpdateReserveTarget = useCallback(
    (targetCents: number) => {
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        profile: {
          ...prev.profile,
          emergencyReserveTargetCents: targetCents,
        },
      }));
      notifyToast(`Objetivo da reserva atualizado para ${centsToBRL(targetCents)}.`);
    },
    [notifyToast, updateState]
  );

  // Plans handler
  const handleSelectPlan = useCallback(
    (plan: PlanTier, paymentMethod?: 'pix' | 'cartao') => {
      updateState((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          plan,
        },
      }));
      if (plan === 'premium') {
        notifyToast(
          `Plano Premium (Demo) ativado via ${paymentMethod === 'cartao' ? 'Cartão' : 'Pix'}!`
        );
      } else {
        notifyToast('Plano alterado para Gratuito.');
      }
    },
    [notifyToast, updateState]
  );

  // Profile & Reverse Budget Sync
  const handleUpdateProfileInfo = useCallback(
    (payload: { name: string; roleLabel: string; emergencyReserveTargetCents: number }) => {
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        profile: {
          ...prev.profile,
          name: payload.name,
          roleLabel: payload.roleLabel,
          emergencyReserveTargetCents: payload.emergencyReserveTargetCents,
        },
      }));
      notifyToast('Dados do perfil atualizados!');
    },
    [notifyToast, updateState]
  );

  const handleUpdateBudgetField = useCallback(
    (
      field: 'monthlyNetIncomeCents' | 'monthlyFixedExpensesCents' | 'monthlyReserveGoalCents',
      valueCents: number
    ) => {
      updateState((prev) => {
        const nowIso = new Date().toISOString();
        const horizon = addMonthsISO(periodEnd, 1);
        const expanded = expandTransactionsThroughDate(prev, horizon, periodStart);

        if (field === 'monthlyNetIncomeCents') {
          const periodRevenues = expanded.filter(
            (tx) =>
              tx.type === 'receita' &&
              tx.status !== 'cancelado' &&
              tx.date >= periodStart &&
              tx.date <= periodEnd
          );

          const primaryRevenue =
            periodRevenues.find(
              (tx) =>
                tx.recurrenceRuleId === 'rec-bolsa-lucas' ||
                tx.recurrenceRuleId === 'rec-sal-bia' ||
                tx.id.startsWith('profile-income-')
            ) ??
            [...periodRevenues].sort((a, b) => b.amountCents - a.amountCents)[0];

          const otherRevenuesTotal = periodRevenues
            .filter((tx) => tx.id !== primaryRevenue?.id)
            .reduce((sum, tx) => sum + tx.amountCents, 0);
          const targetPrimaryCents = Math.max(0, valueCents - otherRevenuesTotal);

          let nextTransactions = [...prev.transactions];
          let nextRules = [...prev.recurringRules];
          let nextSkipped = [...prev.skippedOccurrenceKeys];

          if (primaryRevenue) {
            if (primaryRevenue.recurrenceRuleId) {
              nextRules = nextRules.map((rule) =>
                rule.id === primaryRevenue.recurrenceRuleId
                  ? { ...rule, amountCents: targetPrimaryCents, active: targetPrimaryCents > 0 }
                  : rule
              );
            }
            if (primaryRevenue.isVirtualRecurring && primaryRevenue.occurrenceKey) {
              if (targetPrimaryCents === 0) {
                if (!nextSkipped.includes(primaryRevenue.occurrenceKey)) {
                  nextSkipped.push(primaryRevenue.occurrenceKey);
                }
              } else {
                nextTransactions.push({
                  ...primaryRevenue,
                  id: `profile-income-${periodStart}`,
                  amountCents: targetPrimaryCents,
                  isVirtualRecurring: false,
                });
              }
            } else if (targetPrimaryCents === 0) {
              nextTransactions = nextTransactions.filter((t) => t.id !== primaryRevenue.id);
            } else {
              nextTransactions = nextTransactions.map((t) =>
                t.id === primaryRevenue.id ? { ...t, amountCents: targetPrimaryCents } : t
              );
            }
          } else if (targetPrimaryCents > 0) {
            nextTransactions.unshift({
              id: `profile-income-${periodStart}`,
              type: 'receita',
              description: 'Renda Líquida Mensal',
              amountCents: targetPrimaryCents,
              date: periodStart <= referenceDate && referenceDate <= periodEnd ? referenceDate : periodStart,
              categoryId: 'cat-salario',
              status: 'pago',
              paymentMethodLabel: 'Orçamento Reverso',
              createdAt: nowIso,
            });
          }

          return {
            ...prev,
            isDemoData: false,
            transactions: nextTransactions,
            recurringRules: nextRules,
            skippedOccurrenceKeys: nextSkipped,
            profile: {
              ...prev.profile,
              monthlyNetIncomeCents: valueCents,
            },
          };
        }

        if (field === 'monthlyFixedExpensesCents') {
          const periodFixed = expanded.filter(
            (tx) =>
              tx.type === 'despesa' &&
              tx.status !== 'cancelado' &&
              tx.date >= periodStart &&
              tx.date <= periodEnd &&
              resolveExpenseBudgetKind(tx, prev.categories) === 'fixo'
          );

          let nextTransactions = [...prev.transactions];
          let nextRules = [...prev.recurringRules];
          let nextSkipped = [...prev.skippedOccurrenceKeys];

          if (valueCents === 0) {
            for (const tx of periodFixed) {
              if (tx.isVirtualRecurring && tx.occurrenceKey) {
                if (!nextSkipped.includes(tx.occurrenceKey)) {
                  nextSkipped.push(tx.occurrenceKey);
                }
              } else {
                nextTransactions = nextTransactions.filter((item) => item.id !== tx.id);
              }
            }
          } else if (periodFixed.length === 0) {
            nextTransactions.unshift({
              id: `profile-fixed-${periodStart}`,
              type: 'despesa',
              description: 'Compromissos Fixos do Ciclo',
              amountCents: valueCents,
              date: periodStart <= referenceDate && referenceDate <= periodEnd ? referenceDate : periodStart,
              categoryId: 'cat-moradia',
              status: 'pago',
              budgetKind: 'fixo',
              paymentMethodLabel: 'Orçamento Reverso',
              createdAt: nowIso,
            });
          } else {
            // Materialize any virtual fixed expenses in the current period first
            const materializedFixed: Transaction[] = [];
            for (const tx of periodFixed) {
              if (tx.isVirtualRecurring && tx.occurrenceKey) {
                const mat: Transaction = {
                  ...tx,
                  id: `tx_fixed_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  isVirtualRecurring: false,
                };
                nextTransactions.push(mat);
                materializedFixed.push(mat);
              } else {
                materializedFixed.push(tx);
              }
            }

            const currentFixedSum = materializedFixed.reduce((acc, t) => acc + t.amountCents, 0);
            if (currentFixedSum <= 0) {
              const target = materializedFixed[0];
              nextTransactions = nextTransactions.map((t) =>
                t.id === target.id ? { ...t, amountCents: valueCents } : t
              );
            } else {
              // Scale proportionally and place any integer rounding remainder on the largest item
              const sorted = [...materializedFixed].sort((a, b) => b.amountCents - a.amountCents);
              let assigned = 0;
              const newAmounts = new Map<string, number>();
              for (let i = 1; i < sorted.length; i++) {
                const item = sorted[i];
                const scaled = Math.max(1, Math.round((item.amountCents / currentFixedSum) * valueCents));
                newAmounts.set(item.id, scaled);
                assigned += scaled;
              }
              const largestAdjusted = Math.max(0, valueCents - assigned);
              newAmounts.set(sorted[0].id, largestAdjusted);

              nextTransactions = nextTransactions.map((t) => {
                const updated = newAmounts.get(t.id);
                if (updated === undefined) return t;
                return { ...t, amountCents: updated };
              });

              if (sorted.length === 1 && sorted[0].recurrenceRuleId) {
                nextRules = nextRules.map((r) =>
                  r.id === sorted[0].recurrenceRuleId ? { ...r, amountCents: valueCents } : r
                );
              }
            }
          }

          return {
            ...prev,
            isDemoData: false,
            transactions: nextTransactions,
            recurringRules: nextRules,
            skippedOccurrenceKeys: nextSkipped,
            profile: {
              ...prev.profile,
              monthlyFixedExpensesCents: valueCents,
            },
          };
        }

        // monthlyReserveGoalCents
        const periodReserves = prev.reserveMovements.filter(
          (m) => m.date >= periodStart && m.date <= periodEnd
        );
        const primaryAporte =
          periodReserves.find(
            (m) =>
              m.type === 'aporte' &&
              (m.id === 'lucas-res-atual' ||
                m.id === 'bia-res-1' ||
                m.id.startsWith('profile-reserve-'))
          ) ?? periodReserves.find((m) => m.type === 'aporte');

        const otherReserveNet = periodReserves
          .filter((m) => m.id !== primaryAporte?.id)
          .reduce((acc, m) => acc + (m.type === 'aporte' ? m.amountCents : -m.amountCents), 0);

        const targetPrimaryAporte = Math.max(0, valueCents - otherReserveNet);
        let nextReserves = [...prev.reserveMovements];

        if (primaryAporte) {
          if (targetPrimaryAporte === 0) {
            nextReserves = nextReserves.filter((m) => m.id !== primaryAporte.id);
          } else {
            nextReserves = nextReserves.map((m) =>
              m.id === primaryAporte.id ? { ...m, amountCents: targetPrimaryAporte } : m
            );
          }
        } else if (targetPrimaryAporte > 0) {
          nextReserves.unshift({
            id: `profile-reserve-${periodStart}`,
            type: 'aporte',
            amountCents: targetPrimaryAporte,
            date: periodStart <= referenceDate && referenceDate <= periodEnd ? referenceDate : periodStart,
            description: 'Meta de Reserva Mensal',
            createdAt: nowIso,
          });
        }

        return {
          ...prev,
          isDemoData: false,
          reserveMovements: nextReserves,
          profile: {
            ...prev.profile,
            monthlyReserveGoalCents: valueCents,
          },
        };
      });

      notifyToast('Orçamento reverso atualizado e Teto recalculado!');
    },
    [notifyToast, periodEnd, periodStart, referenceDate, updateState]
  );

  const handleTogglePreference = useCallback(
    (pref: 'proactiveAlerts' | 'biometricLock', value: boolean) => {
      updateState((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          [pref]: value,
        },
      }));
      notifyToast(
        pref === 'proactiveAlerts'
          ? value
            ? 'Alertas proativos ativados.'
            : 'Alertas proativos desativados.'
          : value
          ? 'Bloqueio biométrico ativado.'
          : 'Bloqueio biométrico desativado.'
      );
    },
    [notifyToast, updateState]
  );

  const handleAddCategory = useCallback(
    (payload: { name: string; type: TransactionType | 'ambos'; color: string; icon: string }) => {
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        categories: [
          ...prev.categories,
          {
            id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: payload.name,
            type: payload.type,
            color: payload.color,
            icon: payload.icon,
            isDefault: false,
          },
        ],
      }));
      notifyToast(`Categoria "${payload.name}" adicionada!`);
    },
    [notifyToast, updateState]
  );

  const handleRemoveCategory = useCallback(
    (categoryId: string) => {
      updateState((prev) => ({
        ...prev,
        isDemoData: false,
        categories: prev.categories.filter((c) => c.id !== categoryId),
        transactions: prev.transactions.map((tx) =>
          tx.categoryId === categoryId ? { ...tx, categoryId: 'cat-outros' } : tx
        ),
        recurringRules: prev.recurringRules.map((rule) =>
          rule.categoryId === categoryId ? { ...rule, categoryId: 'cat-outros' } : rule
        ),
      }));
      notifyToast('Categoria removida. Lançamentos e regras movidos para Outros.');
    },
    [notifyToast, updateState]
  );

  const handleExportBackup = useCallback(() => {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `teto-finance-backup-${referenceDate}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    notifyToast('Backup JSON exportado!');
  }, [notifyToast, referenceDate, state]);

  const handleRestoreBackup = useCallback(
    (restoredWorkspace: WorkspaceState) => {
      if (!session) return;
      const saveRes = financialRepository.saveForAccount(session.accountId, restoredWorkspace);
      if (!saveRes.ok && saveRes.error) {
        notifyToast(saveRes.error, 'error');
        return;
      }
      setState(restoredWorkspace);
      setEditingTransaction(null);
      setQuickRecordDraft(null);
      setMonthOffset(0);
      notifyToast('Backup restaurado nesta conta e Teto recalculado!');
    },
    [notifyToast, session]
  );

  const handleRequestResetDemo = useCallback(() => {
    if (!session) return;
    setPendingConfirm({
      title: 'Restaurar dados demonstrativos',
      description:
        'Seus lançamentos atuais desta conta serão substituídos pelos dados originais de demonstração.',
      confirmLabel: 'Restaurar Demo',
      tone: 'warning',
      action: () => {
        const restored = financialRepository.resetToDemoForAccount(session.accountId);
        setState(restored);
        setMonthOffset(0);
        setActiveView('dashboard');
        notifyToast('Dados de demonstração restaurados!');
      },
    });
  }, [notifyToast, session]);

  const handleRequestResetEmpty = useCallback(() => {
    if (!session || !state) return;
    setPendingConfirm({
      title: 'Zerar carteira e começar do zero',
      description:
        'Todas as movimentações, metas e reservas desta conta serão removidas para você iniciar um planejamento do zero.',
      confirmLabel: 'Zerar Tudo',
      tone: 'danger',
      action: () => {
        const cleared = financialRepository.resetToEmptyForAccount(
          session.accountId,
          state.profile
        );
        setState(cleared);
        setMonthOffset(0);
        setActiveView('dashboard');
        notifyToast('Carteira zerada com sucesso.');
      },
    });
  }, [notifyToast, session, state]);

  const handleRequestLogout = useCallback(() => {
    setPendingConfirm({
      title: 'Sair da conta',
      description:
        'Seus dados ficam salvos localmente no navegador. Deseja retornar à tela de login?',
      confirmLabel: 'Sair',
      tone: 'warning',
      action: () => {
        clearSession();
        setSession(null);
        setState(null);
        setEditingTransaction(null);
        setQuickRecordDraft(null);
        setMonthOffset(0);
        setActiveView('dashboard');
      },
    });
  }, []);

  if (!session || !state || !ceiling) {
    return (
      <LoginView
        accounts={accounts}
        onAuthenticate={handleAuthenticate}
        onQuickDemoLogin={handleQuickDemoLogin}
        onRegister={handleRegister}
      />
    );
  }

  return (
    <>
      {activeView === 'dashboard' && (
        <DashboardView
          state={state}
          ceiling={ceiling}
          periodLabel={periodLabel}
          monthOffset={monthOffset}
          referenceDate={referenceDate}
          periodTransactions={periodTransactions}
          onChangeMonthOffset={setMonthOffset}
          onUpdateClosingDay={(closingDay) => {
            updateState((prev) => ({
              ...prev,
              settings: { ...prev.settings, cycleClosingDay: closingDay },
            }));
            notifyToast(
              closingDay === 0
                ? 'Ciclo alterado para mês calendário.'
                : `Fechamento do ciclo configurado para dia ${closingDay}.`
            );
          }}
          onNavigate={handleNavigate}
          onOpenScanner={() => {
            setEditingTransaction(null);
            setQuickRecordDraft({ openScanner: true, type: 'despesa' });
            setActiveView('quick-record');
          }}
          onEditTransaction={(tx) => {
            setQuickRecordDraft(null);
            setEditingTransaction(tx);
            setActiveView('quick-record');
          }}
          onNotifyToast={notifyToast}
          toasts={toasts}
        />
      )}

      {activeView === 'quick-record' && (
        <QuickRecordView
          categories={state.categories}
          existingTransactions={state.transactions}
          ceiling={ceiling}
          editingTransaction={editingTransaction}
          initialDraft={quickRecordDraft}
          onNavigate={handleNavigate}
          onSaveSingleOrEdit={handleSaveSingleOrEdit}
          onSaveInstallments={handleSaveInstallments}
          onSaveRecurringRule={handleSaveRecurringRule}
          onRequestDelete={handleRequestDeleteTransaction}
          onRequestDeleteInstallmentGroup={handleRequestDeleteInstallmentGroup}
          toasts={toasts}
        />
      )}

      {activeView === 'goals' && (
        <GoalsReserveView
          state={state}
          ceiling={ceiling}
          periodTransactions={periodTransactions}
          referenceDate={referenceDate}
          onNavigate={handleNavigate}
          onAddReserveMovement={handleAddReserveMovement}
          onRequestDeleteReserveMovement={handleRequestDeleteReserveMovement}
          onCreateGoal={handleCreateGoal}
          onContributeToGoal={handleContributeToGoal}
          onRequestDeleteGoal={handleRequestDeleteGoal}
          onUpdateReserveTarget={handleUpdateReserveTarget}
          toasts={toasts}
        />
      )}

      {activeView === 'plans' && (
        <PlansView
          currentPlan={state.profile.plan}
          referenceDate={referenceDate}
          onNavigate={handleNavigate}
          onSelectPlan={handleSelectPlan}
          toasts={toasts}
        />
      )}

      {activeView === 'reports' && (
        <ReportsView
          state={state}
          ceiling={ceiling}
          periodLabel={periodLabel}
          periodTransactions={periodTransactions}
          referenceDate={referenceDate}
          onNavigate={handleNavigate}
          onNotifyToast={notifyToast}
          toasts={toasts}
        />
      )}

      {activeView === 'ai-chat' && (
        <AiChatView
          state={state}
          ceiling={ceiling}
          periodLabel={periodLabel}
          periodTransactions={periodTransactions}
          referenceDate={referenceDate}
          onNavigate={handleNavigate}
          onRegisterSuggestedExpense={(draft) => {
            setEditingTransaction(null);
            setQuickRecordDraft(draft);
            setActiveView('quick-record');
          }}
          onNotifyToast={notifyToast}
          toasts={toasts}
        />
      )}

      {activeView === 'profile' && (
        <ProfileView
          state={state}
          onNavigate={handleNavigate}
          onUpdateProfileInfo={handleUpdateProfileInfo}
          onUpdateBudgetField={handleUpdateBudgetField}
          onTogglePreference={handleTogglePreference}
          onAddCategory={handleAddCategory}
          onRemoveCategory={handleRemoveCategory}
          onExportBackup={handleExportBackup}
          onRestoreBackup={handleRestoreBackup}
          onRequestResetDemo={handleRequestResetDemo}
          onRequestResetEmpty={handleRequestResetEmpty}
          onRequestLogout={handleRequestLogout}
          toasts={toasts}
        />
      )}

      {activeView === 'statement' && (
        <StatementView
          state={state}
          periodLabel={periodLabel}
          periodStart={periodStart}
          periodEnd={periodEnd}
          allExpandedTransactions={allExpandedTransactions}
          periodTransactions={periodTransactions}
          onNavigate={handleNavigate}
          onEditTransaction={(tx) => {
            setQuickRecordDraft(null);
            setEditingTransaction(tx);
            setActiveView('quick-record');
          }}
          onToggleTransactionStatus={handleToggleTransactionStatus}
          onRequestReverseTransaction={handleRequestReverseTransaction}
          onRequestDeleteTransaction={handleRequestDeleteTransaction}
          onToggleRecurringRule={handleToggleRecurringRule}
          onRequestDeleteRecurringRule={handleRequestDeleteRecurringRule}
          toasts={toasts}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel}
        tone={pendingConfirm?.tone}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const act = pendingConfirm?.action;
          setPendingConfirm(null);
          act?.();
        }}
      />
    </>
  );
}
