import {
  addDaysISO,
  addMonthsISO,
  centsToBRL,
  diffDaysInclusive,
  isValidISODate,
  parseCurrencyInputToCents,
} from './formatters';
import type {
  AssistantAnalysis,
  Category,
  CategorySummary,
  DailyCeilingResult,
  DailyEvolutionPoint,
  ExpenseBudgetKind,
  MicrospendingRadarData,
  RecurrenceFrequency,
  RecurringRule,
  ReserveMovement,
  Transaction,
  TransactionType,
  WeeklyConsumptionRow,
  WorkspaceState,
} from './types';

export const MAX_INSTALLMENTS = 48;

/**
 * Regra obrigatória do Teto:
 * Truncar o resultado em duas casas decimais (centavos inteiros), nunca arredondar.
 * Se saldo disponível <= 0 ou dias <= 0, retornar 0 (R$ 0,00).
 */
export function truncateCentsPerDay(availableCents: number, remainingDays: number): number {
  if (!Number.isFinite(availableCents) || !Number.isFinite(remainingDays)) return 0;
  if (availableCents <= 0 || remainingDays <= 0) return 0;
  return Math.trunc(availableCents / remainingDays);
}

function advanceByFrequency(isoDate: string, frequency: RecurrenceFrequency, step: number): string {
  switch (frequency) {
    case 'semanal':
      return addDaysISO(isoDate, step * 7);
    case 'quinzenal':
      return addDaysISO(isoDate, step * 14);
    case 'mensal':
      return addMonthsISO(isoDate, step);
    case 'anual':
      return addMonthsISO(isoDate, step * 12);
  }
}

export function expandTransactionsThroughDate(
  state: WorkspaceState,
  rangeEnd: string,
  rangeStart = '1900-01-01'
): Transaction[] {
  const materializedKeys = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.occurrenceKey) {
      materializedKeys.add(tx.occurrenceKey);
    }
  }
  const skippedKeys = new Set(state.skippedOccurrenceKeys || []);

  const virtualTransactions: Transaction[] = [];

  for (const rule of state.recurringRules) {
    if (!rule.active) continue;
    if (!isValidISODate(rule.startDate)) continue;
    const effectiveEnd = rule.endDate && rule.endDate < rangeEnd ? rule.endDate : rangeEnd;
    if (rule.startDate > effectiveEnd) continue;

    let step = 0;
    while (step < 600) {
      const occurrenceDate = advanceByFrequency(rule.startDate, rule.frequency, step);
      if (occurrenceDate > effectiveEnd) break;

      if (occurrenceDate >= rangeStart) {
        const occurrenceKey = `${rule.id}::${occurrenceDate}`;
        if (!materializedKeys.has(occurrenceKey) && !skippedKeys.has(occurrenceKey)) {
          virtualTransactions.push({
            id: `virtual_${rule.id}_${occurrenceDate}`,
            type: rule.type,
            description: rule.description,
            amountCents: rule.amountCents,
            date: occurrenceDate,
            categoryId: rule.categoryId,
            status: rule.defaultStatus,
            budgetKind: rule.budgetKind ?? (rule.type === 'despesa' ? 'fixo' : undefined),
            paymentMethodLabel: 'Recorrente',
            recurrenceRuleId: rule.id,
            occurrenceKey,
            isVirtualRecurring: true,
            createdAt: rule.createdAt,
          });
        }
      }
      step += 1;
    }
  }

  return [...state.transactions, ...virtualTransactions];
}

/**
 * Ordenação canônica exigida pelas regras de negócio:
 * 1) Data (mais recente / próxima primeiro)
 * 2) Valor (maior para menor)
 * 3) Ordem alfabética (A -> Z em pt-BR)
 */
export function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    if (a.amountCents !== b.amountCents) {
      return b.amountCents - a.amountCents;
    }
    return a.description.localeCompare(b.description, 'pt-BR', { sensitivity: 'base' });
  });
}

function getEffectiveSignedCashImpact(tx: Transaction): number {
  if (tx.status === 'cancelado') return 0;
  return tx.type === 'receita' ? tx.amountCents : -tx.amountCents;
}

export function calculateReserveBalanceCents(reserveMovements: ReserveMovement[], upToDate?: string): number {
  let balance = 0;
  for (const mov of reserveMovements) {
    if (upToDate && mov.date > upToDate) continue;
    if (mov.type === 'aporte') {
      balance += mov.amountCents;
    } else {
      balance -= mov.amountCents;
    }
  }
  return balance;
}

export function resolveExpenseBudgetKind(tx: Transaction, categories: Category[]): ExpenseBudgetKind {
  if (tx.budgetKind) return tx.budgetKind;
  if (tx.recurrenceRuleId) return 'fixo';
  const cat = categories.find((c) => c.id === tx.categoryId);
  if (cat && ['moradia', 'assinaturas', 'educação'].includes(cat.name.toLowerCase())) {
    return 'fixo';
  }
  return 'livre';
}

/**
 * Cálculo central do Teto Gastável Diário e métricas do período financeiro.
 */
export function calculateDailyCeiling(
  state: WorkspaceState,
  periodStart: string,
  periodEnd: string,
  referenceDate: string
): DailyCeilingResult {
  const futureHorizon = addMonthsISO(periodEnd, 12);
  const allTransactions = expandTransactionsThroughDate(state, futureHorizon);

  let carryoverBeforePeriodCents = 0;
  let periodRevenuesCents = 0;
  let periodPendingRevenuesCents = 0;
  let periodExpensesCents = 0;
  let periodFixedExpensesCents = 0;
  let periodVariableExpensesCents = 0;
  let periodPaidExpensesCents = 0;
  let periodPendingExpensesCents = 0;
  let currentCashBalanceCents = 0;
  let futureCommitmentsCents = 0;
  let futureCommitmentsCount = 0;

  for (const tx of allTransactions) {
    if (tx.status === 'cancelado' || tx.isReversal) continue;

    if (tx.date <= referenceDate && tx.status === 'pago') {
      currentCashBalanceCents += getEffectiveSignedCashImpact(tx);
    }

    if (tx.date < periodStart) {
      // Apenas movimentações confirmadas (pagas/recebidas) compõem o saldo de caixa anterior carregado
      if (tx.status === 'pago') {
        carryoverBeforePeriodCents += getEffectiveSignedCashImpact(tx);
      }
    } else if (tx.date >= periodStart && tx.date <= periodEnd) {
      if (tx.type === 'receita') {
        if (tx.status === 'pago') {
          periodRevenuesCents += tx.amountCents;
        } else {
          periodPendingRevenuesCents += tx.amountCents;
        }
      } else {
        periodExpensesCents += tx.amountCents;
        const kind = resolveExpenseBudgetKind(tx, state.categories);
        if (kind === 'fixo') {
          periodFixedExpensesCents += tx.amountCents;
        } else {
          periodVariableExpensesCents += tx.amountCents;
        }
        if (tx.status === 'pago') {
          periodPaidExpensesCents += tx.amountCents;
        } else {
          periodPendingExpensesCents += tx.amountCents;
        }
      }
    } else if (tx.date > periodEnd && tx.type === 'despesa') {
      if (!tx.isVirtualRecurring || tx.date <= addMonthsISO(periodEnd, 1)) {
        futureCommitmentsCents += tx.amountCents;
        futureCommitmentsCount += 1;
      }
    }
  }

  let reserveBeforePeriodNet = 0;
  let periodReserveNetCents = 0;
  let reserveUpToReferenceNet = 0;

  for (const mov of state.reserveMovements) {
    const signedReserveNet = mov.type === 'aporte' ? mov.amountCents : -mov.amountCents;
    if (mov.date <= referenceDate) {
      reserveUpToReferenceNet += signedReserveNet;
    }
    if (mov.date < periodStart) {
      reserveBeforePeriodNet += signedReserveNet;
    } else if (mov.date >= periodStart && mov.date <= periodEnd) {
      periodReserveNetCents += signedReserveNet;
    }
  }

  currentCashBalanceCents -= reserveUpToReferenceNet;
  carryoverBeforePeriodCents -= reserveBeforePeriodNet;

  const availableToSpendCents =
    carryoverBeforePeriodCents +
    periodRevenuesCents -
    periodExpensesCents -
    periodReserveNetCents;

  const plannedFreeCeilingCents =
    carryoverBeforePeriodCents +
    periodRevenuesCents -
    periodFixedExpensesCents -
    periodReserveNetCents;

  const totalDaysInPeriod = diffDaysInclusive(periodStart, periodEnd);
  const isPeriodClosed = referenceDate > periodEnd;

  let remainingDays = 0;
  if (isPeriodClosed) {
    remainingDays = 0;
  } else if (referenceDate < periodStart) {
    remainingDays = totalDaysInPeriod;
  } else {
    remainingDays = diffDaysInclusive(referenceDate, periodEnd);
  }

  const dailyCeilingCents =
    remainingDays > 0 ? truncateCentsPerDay(availableToSpendCents, remainingDays) : 0;

  let previousDayCeilingCents = dailyCeilingCents;
  if (!isPeriodClosed && referenceDate > periodStart && referenceDate <= periodEnd) {
    const yesterday = addDaysISO(referenceDate, -1);
    const yesterdayRemainingDays = diffDaysInclusive(yesterday, periodEnd);
    let todayNewExpenses = 0;
    let todayNewRevenues = 0;
    for (const tx of allTransactions) {
      if (tx.status === 'cancelado' || tx.isReversal) continue;
      if (tx.date === referenceDate) {
        if (tx.type === 'despesa') todayNewExpenses += tx.amountCents;
        else if (tx.status === 'pago') todayNewRevenues += tx.amountCents;
      }
    }
    let todayReserveNet = 0;
    for (const mov of state.reserveMovements) {
      if (mov.date === referenceDate) {
        todayReserveNet += mov.type === 'aporte' ? mov.amountCents : -mov.amountCents;
      }
    }
    const availableYesterdayCents =
      availableToSpendCents + todayNewExpenses - todayNewRevenues + todayReserveNet;
    previousDayCeilingCents = truncateCentsPerDay(availableYesterdayCents, yesterdayRemainingDays);
  }

  const dailyCarryoverDeltaCents = dailyCeilingCents - previousDayCeilingCents;
  const isDeficit = !isPeriodClosed && availableToSpendCents <= 0;

  let healthStatus: 'saudavel' | 'atencao' | 'critico' = 'saudavel';
  if (isDeficit || dailyCeilingCents === 0) {
    healthStatus = 'critico';
  } else if (
    periodRevenuesCents + carryoverBeforePeriodCents > 0 &&
    availableToSpendCents < (periodRevenuesCents + Math.max(0, carryoverBeforePeriodCents)) * 0.15
  ) {
    healthStatus = 'atencao';
  }

  return {
    periodStart,
    periodEnd,
    referenceDate,
    totalDaysInPeriod,
    remainingDays,
    isPeriodClosed,
    carryoverBeforePeriodCents,
    periodRevenuesCents,
    periodPendingRevenuesCents,
    periodExpensesCents,
    periodFixedExpensesCents,
    periodVariableExpensesCents,
    periodPaidExpensesCents,
    periodPendingExpensesCents,
    periodReserveNetCents,
    plannedFreeCeilingCents,
    availableToSpendCents,
    currentCashBalanceCents,
    dailyCeilingCents,
    previousDayCeilingCents,
    dailyCarryoverDeltaCents,
    isDeficit,
    futureCommitmentsCents,
    futureCommitmentsCount,
    healthStatus,
  };
}

export interface InstallmentGenerationInput {
  description: string;
  totalAmountCents: number;
  installmentsCount: number;
  purchaseDate: string;
  firstDueDate: string;
  categoryId: string;
  budgetKind?: ExpenseBudgetKind;
  firstInstallmentPaid: boolean;
  notes?: string;
  existingTransactions?: Transaction[];
}

export function generateInstallments(input: InstallmentGenerationInput): Transaction[] {
  const {
    description,
    totalAmountCents,
    installmentsCount,
    purchaseDate,
    firstDueDate,
    categoryId,
    budgetKind = 'fixo',
    firstInstallmentPaid,
    notes,
    existingTransactions = [],
  } = input;

  if (!description.trim()) {
    throw new Error('Descrição da compra parcelada é obrigatória.');
  }
  if (!Number.isInteger(totalAmountCents) || totalAmountCents <= 0) {
    throw new Error('Valor total deve ser maior que zero.');
  }
  if (!Number.isInteger(installmentsCount) || installmentsCount < 2 || installmentsCount > MAX_INSTALLMENTS) {
    throw new Error(`A quantidade de parcelas deve estar entre 2 e ${MAX_INSTALLMENTS}.`);
  }
  if (!isValidISODate(purchaseDate) || !isValidISODate(firstDueDate)) {
    throw new Error('Datas da compra e do primeiro vencimento devem ser válidas.');
  }

  const groupId = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseParcelCents = Math.floor(totalAmountCents / installmentsCount);
  const remainderCents = totalAmountCents - baseParcelCents * installmentsCount;

  const existingKeys = new Set(
    existingTransactions
      .filter((t) => t.installmentGroupId && t.installmentNumber)
      .map((t) => `${t.installmentGroupId}::${t.installmentNumber}`)
  );

  const createdAt = new Date().toISOString();
  const result: Transaction[] = [];

  for (let i = 0; i < installmentsCount; i++) {
    const parcelNumber = i + 1;
    const key = `${groupId}::${parcelNumber}`;
    if (existingKeys.has(key)) continue;

    const amountCents = baseParcelCents + (i < remainderCents ? 1 : 0);
    const dueDate = addMonthsISO(firstDueDate, i);
    const status = parcelNumber === 1 && firstInstallmentPaid ? 'pago' : 'pendente';

    result.push({
      id: `tx_${groupId}_${parcelNumber}`,
      type: 'despesa',
      description: `${description.trim()} (${parcelNumber}/${installmentsCount})`,
      amountCents,
      date: dueDate,
      purchaseDate,
      categoryId,
      status,
      budgetKind,
      paymentMethodLabel: `Parcelado ${parcelNumber}/${installmentsCount}`,
      installmentGroupId: groupId,
      installmentNumber: parcelNumber,
      totalInstallments: installmentsCount,
      notes,
      createdAt,
    });
  }

  return result;
}

export function hasDuplicateTransaction(
  existing: Transaction[],
  candidate: {
    type: TransactionType;
    description: string;
    amountCents: number;
    date: string;
    excludeId?: string;
  }
): boolean {
  const normDesc = candidate.description.trim().toLowerCase();
  return existing.some(
    (tx) =>
      tx.id !== candidate.excludeId &&
      tx.status !== 'cancelado' &&
      !tx.isReversal &&
      tx.type === candidate.type &&
      tx.amountCents === candidate.amountCents &&
      tx.date === candidate.date &&
      tx.description.trim().toLowerCase() === normDesc
  );
}

export function createReversalPair(
  original: Transaction,
  reversalDate: string,
  reason?: string
): { updatedOriginal: Transaction; reversalEntry: Transaction } {
  if (original.reversedById || original.status === 'cancelado') {
    throw new Error('Esta movimentação já foi estornada ou cancelada.');
  }
  if (original.isReversal) {
    throw new Error('Não é possível estornar um registro de estorno.');
  }

  const reversalId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const reversalEntry: Transaction = {
    id: reversalId,
    type: original.type === 'despesa' ? 'receita' : 'despesa',
    description: `Estorno: ${original.description}`,
    amountCents: original.amountCents,
    date: reversalDate,
    categoryId: original.categoryId,
    status: 'cancelado',
    budgetKind: original.budgetKind,
    isReversal: true,
    relatedTransactionId: original.id,
    notes: reason ? `Estorno (${reason})` : `Estorno vinculado à movimentação ${original.id}`,
    createdAt: new Date().toISOString(),
  };

  const updatedOriginal: Transaction = {
    ...original,
    status: 'cancelado',
    reversedById: reversalId,
  };

  return { updatedOriginal, reversalEntry };
}

export function calculateCategoryBreakdown(
  transactions: Transaction[],
  categories: Category[],
  typeFilter: TransactionType = 'despesa'
): CategorySummary[] {
  const catMap = new Map<string, Category>();
  for (const cat of categories) {
    catMap.set(cat.id, cat);
  }

  const totals = new Map<
    string,
    { totalCents: number; paidCents: number; pendingCents: number; count: number }
  >();

  let grandTotal = 0;

  for (const tx of transactions) {
    if (tx.status === 'cancelado' || tx.isReversal || tx.type !== typeFilter) continue;
    grandTotal += tx.amountCents;
    const prev = totals.get(tx.categoryId) ?? {
      totalCents: 0,
      paidCents: 0,
      pendingCents: 0,
      count: 0,
    };
    prev.totalCents += tx.amountCents;
    if (tx.status === 'pago') prev.paidCents += tx.amountCents;
    else prev.pendingCents += tx.amountCents;
    prev.count += 1;
    totals.set(tx.categoryId, prev);
  }

  const summaries: CategorySummary[] = [];
  for (const [categoryId, stats] of totals.entries()) {
    const cat = catMap.get(categoryId);
    summaries.push({
      categoryId,
      categoryName: cat?.name ?? 'Sem categoria',
      color: cat?.color ?? '#64748B',
      type: cat?.type ?? typeFilter,
      totalCents: stats.totalCents,
      paidCents: stats.paidCents,
      pendingCents: stats.pendingCents,
      count: stats.count,
      percentage: grandTotal > 0 ? (stats.totalCents / grandTotal) * 100 : 0,
    });
  }

  return summaries.sort((a, b) => b.totalCents - a.totalCents);
}

export function calculateDailyEvolution(
  state: WorkspaceState,
  periodStart: string,
  periodEnd: string
): DailyEvolutionPoint[] {
  const allTxs = expandTransactionsThroughDate(state, periodEnd, '1900-01-01');
  const totalDays = diffDaysInclusive(periodStart, periodEnd);

  let runningBalance = 0;
  for (const tx of allTxs) {
    if (tx.status === 'cancelado' || tx.isReversal) continue;
    if (tx.date < periodStart && tx.status === 'pago') {
      runningBalance += getEffectiveSignedCashImpact(tx);
    }
  }
  for (const mov of state.reserveMovements) {
    if (mov.date < periodStart) {
      runningBalance += mov.type === 'aporte' ? -mov.amountCents : mov.amountCents;
    }
  }

  const points: DailyEvolutionPoint[] = [];
  for (let i = 0; i < totalDays; i++) {
    const dayISO = addDaysISO(periodStart, i);
    let dayRev = 0;
    let dayExp = 0;

    for (const tx of allTxs) {
      if (tx.status === 'cancelado' || tx.isReversal || tx.date !== dayISO) continue;
      if (tx.type === 'receita') {
        if (tx.status === 'pago') dayRev += tx.amountCents;
      } else {
        dayExp += tx.amountCents;
      }
    }

    let dayReserveNet = 0;
    for (const mov of state.reserveMovements) {
      if (mov.date === dayISO) {
        dayReserveNet += mov.type === 'aporte' ? mov.amountCents : -mov.amountCents;
      }
    }

    runningBalance += dayRev - dayExp - dayReserveNet;
    const remainingFromDay = totalDays - i;
    const projectedCeilingCents = truncateCentsPerDay(runningBalance, remainingFromDay);

    const [, mm, dd] = dayISO.split('-');
    points.push({
      date: dayISO,
      label: `${dd}/${mm}`,
      revenuesCents: dayRev,
      expensesCents: dayExp,
      cumulativeBalanceCents: runningBalance,
      projectedCeilingCents,
    });
  }

  return points;
}

export function suggestCategoryForDescription(
  description: string,
  categories: Category[],
  type: TransactionType
): string | null {
  const norm = description.trim().toLowerCase();
  if (!norm) return null;

  const eligible = categories.filter((c) => c.type === type || c.type === 'ambos');
  if (eligible.length === 0) return null;

  const keywordPairs: Array<[RegExp, string[]]> = [
    [/(caf[eé]|padaria|almo[cç]o|jantar|lanche|pizza|ifood|mercado|supermercado|restaurante|delivery|a[cç]a[ií])/, ['alimentação']],
    [/(uber|99|metr[oô]|[oô]nibus|transporte|passagem|combust[ií]vel|gasolina|estacionamento)/, ['transporte']],
    [/(aluguel|condom[ií]nio|energia|luz|[aá]gua|internet|g[aá]s|moradia)/, ['moradia']],
    [/(farm[aá]cia|rem[eé]dio|consulta|m[eé]dico|exame|sa[uú]de|academia)/, ['saúde']],
    [/(curso|livro|faculdade|mensalidade|educa[cç][aã]o|udemy)/, ['educação']],
    [/(cinema|show|jogo|bar|viagem|lazer|shopping)/, ['lazer']],
    [/(netflix|spotify|assinatura|icloud|youtube|amazon|prime)/, ['assinaturas']],
    [/(sal[aá]rio|bolsa|est[aá]gio|pagamento|holerite)/, ['salário']],
    [/(freela|freelance|b[oô]nus|extra|comiss[aã]o|pix recebido)/, ['renda extra']],
  ];

  for (const [regex, catNames] of keywordPairs) {
    if (regex.test(norm)) {
      const match = eligible.find((c) => catNames.includes(c.name.toLowerCase()));
      if (match) return match.id;
    }
  }

  return null;
}

export function calculateWeeklyConsumption(
  state: WorkspaceState,
  periodStart: string,
  periodEnd: string,
  referenceDate: string,
  plannedFreeCeilingCents: number
): WeeklyConsumptionRow[] {
  const allTxs = expandTransactionsThroughDate(state, periodEnd, periodStart).filter(
    (tx) =>
      tx.status !== 'cancelado' &&
      !tx.isReversal &&
      tx.type === 'despesa' &&
      tx.date >= periodStart &&
      tx.date <= periodEnd &&
      resolveExpenseBudgetKind(tx, state.categories) === 'livre'
  );

  const totalDays = diffDaysInclusive(periodStart, periodEnd);
  const weekBuckets: Array<{ start: string; end: string; weekNumber: number }> = [];
  let cursor = 0;
  let wk = 1;
  while (cursor < totalDays && wk <= 5) {
    const start = addDaysISO(periodStart, cursor);
    const endOffset = Math.min(cursor + 6, totalDays - 1);
    const end = addDaysISO(periodStart, endOffset);
    weekBuckets.push({ weekNumber: wk, start, end });
    cursor += 7;
    wk += 1;
  }

  const weeklyTarget =
    weekBuckets.length > 0 && plannedFreeCeilingCents > 0
      ? Math.trunc(plannedFreeCeilingCents / weekBuckets.length)
      : 0;

  return weekBuckets.map((bucket) => {
    const spentCents = allTxs
      .filter((tx) => tx.date >= bucket.start && tx.date <= bucket.end)
      .reduce((acc, tx) => acc + tx.amountCents, 0);

    const [, sm, sd] = bucket.start.split('-');
    const [, em, ed] = bucket.end.split('-');
    const isCurrent = referenceDate >= bucket.start && referenceDate <= bucket.end;
    const percentage =
      weeklyTarget > 0 ? Math.min(100, Math.round((spentCents / weeklyTarget) * 100)) : spentCents > 0 ? 100 : 0;

    return {
      weekNumber: bucket.weekNumber,
      label: isCurrent
        ? `Semana ${bucket.weekNumber} (Atual)`
        : `Semana ${bucket.weekNumber} (${Number(sd)}/${sm} - ${Number(ed)}/${em})`,
      spentCents,
      targetCents: weeklyTarget,
      percentage,
      withinLimit: weeklyTarget <= 0 ? spentCents === 0 : spentCents <= weeklyTarget,
      isCurrent,
    };
  });
}

export function calculateMicrospendingRadar(
  periodTransactions: Transaction[],
  categories: Category[],
  ceiling: DailyCeilingResult
): MicrospendingRadarData {
  const variableExpenses = periodTransactions.filter(
    (tx) =>
      tx.status !== 'cancelado' &&
      !tx.isReversal &&
      tx.type === 'despesa' &&
      resolveExpenseBudgetKind(tx, categories) === 'livre'
  );

  const totalVariableCents = variableExpenses.reduce((acc, tx) => acc + tx.amountCents, 0);

  // Agrupamento real por categoria ou subgrupo
  const byCategory = new Map<string, number>();
  for (const tx of variableExpenses) {
    const catName = categories.find((c) => c.id === tx.categoryId)?.name ?? 'Outros';
    byCategory.set(catName, (byCategory.get(catName) ?? 0) + tx.amountCents);
  }

  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = sorted.slice(0, 3);
  const restCents = sorted.slice(3).reduce((acc, [, val]) => acc + val, 0);

  const items = top3.map(([label, amountCents]) => ({
    label,
    amountCents,
    percentage: totalVariableCents > 0 ? Math.round((amountCents / totalVariableCents) * 100) : 0,
  }));

  if (restCents > 0) {
    items.push({
      label: 'Outros',
      amountCents: restCents,
      percentage: totalVariableCents > 0 ? Math.round((restCents / totalVariableCents) * 100) : 0,
    });
  }

  // Analisa dia da semana com maior concentração de gastos variáveis
  const weekendCount = variableExpenses.filter((tx) => {
    const [y, m, d] = tx.date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 5 || dow === 6 || dow === 0;
  }).length;

  const peakWindowLabel =
    weekendCount >= Math.ceil(variableExpenses.length / 2)
      ? 'Sexta a Domingo'
      : 'Dias úteis (horário comercial)';

  const elapsedDays =
    ceiling.referenceDate < ceiling.periodStart
      ? 0
      : Math.max(
          1,
          diffDaysInclusive(
            ceiling.periodStart,
            ceiling.referenceDate <= ceiling.periodEnd ? ceiling.referenceDate : ceiling.periodEnd
          )
        );
  const avgDailyBudget =
    ceiling.plannedFreeCeilingCents > 0 && ceiling.totalDaysInPeriod > 0
      ? Math.trunc(ceiling.plannedFreeCeilingCents / ceiling.totalDaysInPeriod)
      : 0;

  // Conta quantos dias tiveram gasto livre <= teto médio diário
  const spentByDay = new Map<string, number>();
  for (const tx of variableExpenses) {
    spentByDay.set(tx.date, (spentByDay.get(tx.date) ?? 0) + tx.amountCents);
  }

  let daysWithinCeiling = 0;
  for (let i = 0; i < elapsedDays; i++) {
    const dayISO = addDaysISO(ceiling.periodStart, i);
    const daySpent = spentByDay.get(dayISO) ?? 0;
    if (avgDailyBudget > 0 && daySpent <= avgDailyBudget) {
      daysWithinCeiling += 1;
    }
  }

  const expectedSpentUntilToday = avgDailyBudget * elapsedDays;
  const estimatedSavingsCents =
    elapsedDays > 0 ? Math.max(0, expectedSpentUntilToday - totalVariableCents) : 0;

  return {
    hasEnoughData: variableExpenses.length >= 3,
    variableExpensesCount: variableExpenses.length,
    totalVariableCents,
    peakWindowLabel,
    daysWithinCeiling,
    estimatedSavingsCents,
    items,
  };
}

export function analyzeAssistantPrompt(
  prompt: string,
  ceiling: DailyCeilingResult,
  state: WorkspaceState,
  referenceDate: string
): AssistantAnalysis {
  const trimmed = prompt.trim();
  const norm = trimmed.toLowerCase();

  // Extrai possível valor monetário citado pelo usuário (ex: "R$ 55", "55,00", "100")
  const moneyMatch = trimmed.match(/(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)/i);
  const parsedAmount = moneyMatch ? parseCurrencyInputToCents(moneyMatch[1]) : null;

  const suggestedCatId =
    suggestCategoryForDescription(trimmed, state.categories, 'despesa') ??
    state.categories.find((c) => c.type === 'despesa' || c.type === 'ambos')?.id ??
    'cat-outros';

  // Caso 1: Pedido de resumo de microgastos
  if (/(microgasto|caf[eé]|resumo|onde.*gast|padr[aã]o)/.test(norm) && !parsedAmount) {
    const periodTxs = expandTransactionsThroughDate(state, ceiling.periodEnd, ceiling.periodStart).filter(
      (t) =>
        t.date >= ceiling.periodStart &&
        t.date <= ceiling.periodEnd &&
        t.type === 'despesa' &&
        t.status !== 'cancelado' &&
        resolveExpenseBudgetKind(t, state.categories) === 'livre'
    );
    const totalLivre = periodTxs.reduce((acc, t) => acc + t.amountCents, 0);
    const topCategory = calculateCategoryBreakdown(periodTxs, state.categories, 'despesa')[0];

    return {
      replyText:
        periodTxs.length === 0
          ? `Você ainda não registrou gastos livres neste ciclo. Seu teto disponível continua intacto em ${centsToBRL(
              ceiling.availableToSpendCents
            )} (${centsToBRL(ceiling.dailyCeilingCents)}/dia).`
          : `Analisei seus ${periodTxs.length} gastos livres deste ciclo: eles somam ${centsToBRL(
              totalLivre
            )}${
              topCategory
                ? `, liderados por ${topCategory.categoryName} (${centsToBRL(topCategory.totalCents)})`
                : ''
            }. Seu teto livre atual é de ${centsToBRL(ceiling.availableToSpendCents)} (${centsToBRL(
              ceiling.dailyCeilingCents
            )}/dia para os próximos ${ceiling.remainingDays} dias).`,
    };
  }

  // Caso 2: Simulação de reserva ("quanto sobra se eu guardar X?")
  if (/(guardar|poupar|reserva|aportar)/.test(norm)) {
    const reserveAmount = parsedAmount ?? 10000;
    const afterReserve = ceiling.availableToSpendCents - reserveAmount;
    const afterDaily =
      ceiling.remainingDays > 0 ? truncateCentsPerDay(afterReserve, ceiling.remainingDays) : 0;
    const daysImpact =
      ceiling.dailyCeilingCents > 0 ? (reserveAmount / ceiling.dailyCeilingCents).toFixed(1).replace('.', ',') : '0,0';

    return {
      replyText: `Fiz a simulação com seus dados reais: guardando ${centsToBRL(
        reserveAmount
      )} na reserva agora, seu teto livre passa de ${centsToBRL(
        ceiling.availableToSpendCents
      )} para ${centsToBRL(Math.max(0, afterReserve))}, com limite diário ajustado para ${centsToBRL(
        afterDaily
      )}/dia nos próximos ${ceiling.remainingDays} dias.`,
      decisionTitle: `Simulação de Aporte (${centsToBRL(reserveAmount)})`,
      amountCents: reserveAmount,
      daysImpactText: `-${daysImpact} dias de teto`,
      impactBarPercent:
        ceiling.availableToSpendCents > 0
          ? Math.min(100, Math.round((reserveAmount / ceiling.availableToSpendCents) * 100))
          : 100,
      projectedFreeCents: afterReserve,
      projectedDailyCents: afterDaily,
      decisionSummary:
        afterReserve >= 0
          ? `Sua saúde financeira continua positiva e sua reserva cresce ${centsToBRL(reserveAmount)} imediatamente.`
          : `Atenção: esse aporte deixaria seu teto livre negativo em ${centsToBRL(Math.abs(afterReserve))}.`,
    };
  }

  // Caso 3: Decisão de compra / gasto (com valor explícito ou padrão R$ 55,00 para perguntas de delivery/pizza)
  const testAmountCents = parsedAmount ?? (/(pizza|delivery|lanche|roupa|compra|pedir)/.test(norm) ? 5500 : null);

  if (testAmountCents && testAmountCents > 0) {
    const projectedFreeCents = ceiling.availableToSpendCents - testAmountCents;
    const projectedDailyCents =
      ceiling.remainingDays > 0 ? truncateCentsPerDay(projectedFreeCents, ceiling.remainingDays) : 0;
    const daysImpact =
      ceiling.dailyCeilingCents > 0
        ? (testAmountCents / ceiling.dailyCeilingCents).toFixed(1).replace('.', ',')
        : '—';

    const impactPct =
      ceiling.availableToSpendCents > 0
        ? Math.min(100, Math.max(8, Math.round((testAmountCents / ceiling.availableToSpendCents) * 100)))
        : 100;

    const shortDesc =
      /(pizza|delivery)/.test(norm)
        ? 'Delivery / Pizza'
        : /(caf[eé]|padaria)/.test(norm)
        ? 'Café & Padaria'
        : /(uber|transporte)/.test(norm)
        ? 'Transporte / Uber'
        : 'Gasto Planejado via Teto IA';

    return {
      replyText: `Fiz o cálculo reverso para você (${referenceDate.split('-').reverse().join('/')}): você ainda tem ${centsToBRL(
        ceiling.availableToSpendCents
      )} livres para os próximos ${ceiling.remainingDays} dias do ciclo (média segura de ${centsToBRL(
        ceiling.dailyCeilingCents
      )}/dia).`,
      decisionTitle: `Impacto (${centsToBRL(testAmountCents)})`,
      amountCents: testAmountCents,
      daysImpactText: daysImpact === '—' ? 'Sem teto ativo' : `-${daysImpact} dias de teto`,
      impactBarPercent: impactPct,
      projectedFreeCents,
      projectedDailyCents,
      decisionSummary:
        projectedFreeCents >= 0
          ? `Se registrar esse gasto hoje, seu saldo livre ficará em ${centsToBRL(
              projectedFreeCents
            )} (${centsToBRL(projectedDailyCents)}/dia).`
          : `Atenção: esse gasto ultrapassa seu teto livre atual em ${centsToBRL(
              Math.abs(projectedFreeCents)
            )}, zerando o teto diário do ciclo.`,
      suggestedDescription: shortDesc,
      suggestedCategoryId: suggestedCatId,
    };
  }

  // Caso 4: Consulta direta sobre teto diário, saldo, gastos, economia ou orçamento
  if (/(teto|saldo|caixa|quanto.*tenho|quanto.*gastei|or[cç]amento|economi|dispon[ií]vel)/.test(norm)) {
    const reserveTotal = calculateReserveBalanceCents(state.reserveMovements);
    if (ceiling.periodRevenuesCents === 0 && ceiling.periodExpensesCents === 0 && ceiling.carryoverBeforePeriodCents === 0) {
      return {
        replyText:
          'Ainda não há movimentações suficientes registradas neste ciclo para analisar seus padrões de gasto. Cadastre receitas e despesas pelo botão + para liberar o cálculo completo.',
      };
    }

    return {
      replyText: `Resumo real do seu ciclo atual: receitas confirmadas de ${centsToBRL(
        ceiling.periodRevenuesCents
      )}, gastos fixos de ${centsToBRL(ceiling.periodFixedExpensesCents)}, gastos livres de ${centsToBRL(
        ceiling.periodVariableExpensesCents
      )} e saldo na reserva de ${centsToBRL(reserveTotal)}. Seu teto livre disponível é ${centsToBRL(
        ceiling.availableToSpendCents
      )} (${centsToBRL(ceiling.dailyCeilingCents)}/dia para ${ceiling.remainingDays} dias).`,
    };
  }

  return {
    replyText: `Com base nos dados reais desta conta, você tem ${centsToBRL(
      ceiling.availableToSpendCents
    )} de teto livre para ${ceiling.remainingDays} dias restantes (${centsToBRL(
      ceiling.dailyCeilingCents
    )}/dia). Para simular uma compra sem registrá-la, informe o valor (ex: "Posso gastar R$ 45 no cinema?").`,
  };
}
