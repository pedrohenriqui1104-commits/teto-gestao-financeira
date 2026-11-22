import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAssistantPrompt,
  calculateCategoryBreakdown,
  calculateDailyCeiling,
  calculateDailyEvolution,
  calculateMicrospendingRadar,
  calculateReserveBalanceCents,
  calculateWeeklyConsumption,
  createReversalPair,
  expandTransactionsThroughDate,
  generateInstallments,
  hasDuplicateTransaction,
  sortTransactions,
  suggestCategoryForDescription,
  truncateCentsPerDay,
} from './ceilingEngine';
import {
  centsToBRL,
  formatDateBR,
  getNextBusinessDayISO,
  isNonBusinessDay,
  parseCurrencyInputToCents,
} from './formatters';
import type { Category, Transaction, WorkspaceState } from './types';

function makeEmptyState(): WorkspaceState {
  return {
    version: 2,
    isDemoData: false,
    transactions: [],
    recurringRules: [],
    skippedOccurrenceKeys: [],
    categories: [
      { id: 'cat-sal', name: 'Salário', type: 'receita', color: '#10B981' },
      { id: 'cat-ali', name: 'Alimentação', type: 'despesa', color: '#E53935' },
      { id: 'cat-mor', name: 'Moradia', type: 'despesa', color: '#F59E0B' },
      { id: 'cat-tra', name: 'Transporte', type: 'despesa', color: '#3B82F6' },
    ],
    reserveMovements: [],
    goals: [],
    profile: {
      name: 'Teste',
      roleLabel: 'Usuário',
      email: 'teste@teto.app',
      monthlyNetIncomeCents: 180000,
      monthlyFixedExpensesCents: 80000,
      monthlyReserveGoalCents: 20000,
      emergencyReserveTargetCents: 540000,
      plan: 'free',
      proactiveAlerts: true,
      biometricLock: false,
      level: 1,
    },
    settings: { cycleClosingDay: 0 },
  };
}

test('truncamento do teto diário nunca arredonda para cima', () => {
  assert.equal(truncateCentsPerDay(10000, 3), 3333);
  assert.equal(truncateCentsPerDay(20000, 3), 6666);
  assert.equal(truncateCentsPerDay(-5000, 10), 0);
  assert.equal(truncateCentsPerDay(0, 10), 0);
});

test('cálculo do teto inclui o dia atual e trata saldo insuficiente como R$ 0,00', () => {
  const state = makeEmptyState();
  state.transactions.push(
    {
      id: 't1',
      type: 'receita',
      description: 'Salário',
      amountCents: 300000,
      date: '2026-11-05',
      categoryId: 'cat-sal',
      status: 'pago',
      createdAt: '2026-11-05T10:00:00Z',
    },
    {
      id: 't2',
      type: 'despesa',
      description: 'Aluguel',
      amountCents: 100000,
      date: '2026-11-10',
      categoryId: 'cat-mor',
      status: 'pago',
      budgetKind: 'fixo',
      createdAt: '2026-11-10T10:00:00Z',
    }
  );

  const result = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(result.remainingDays, 10);
  assert.equal(result.availableToSpendCents, 200000);
  assert.equal(result.dailyCeilingCents, 20000);
  assert.equal(result.isDeficit, false);

  const lastDay = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-30');
  assert.equal(lastDay.remainingDays, 1);
  assert.equal(lastDay.dailyCeilingCents, 200000);

  state.transactions.push({
    id: 't3',
    type: 'despesa',
    description: 'Emergência',
    amountCents: 250000,
    date: '2026-11-21',
    categoryId: 'cat-mor',
    status: 'pago',
    budgetKind: 'livre',
    createdAt: '2026-11-21T10:00:00Z',
  });
  const deficit = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(deficit.availableToSpendCents, -50000);
  assert.equal(deficit.dailyCeilingCents, 0);
  assert.equal(deficit.isDeficit, true);
  assert.equal(deficit.healthStatus, 'critico');
});

test('alteração retroativa e saldo não utilizado de dias anteriores recalculam o teto seguinte', () => {
  const state = makeEmptyState();
  state.transactions.push({
    id: 'oct-1',
    type: 'receita',
    description: 'Sobra Outubro',
    amountCents: 30000,
    date: '2026-10-25',
    categoryId: 'cat-sal',
    status: 'pago',
    createdAt: '2026-10-25T10:00:00Z',
  });
  state.transactions.push({
    id: 'nov-1',
    type: 'receita',
    description: 'Salário Novembro',
    amountCents: 270000,
    date: '2026-11-01',
    categoryId: 'cat-sal',
    status: 'pago',
    createdAt: '2026-11-01T10:00:00Z',
  });

  const day20 = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-20');
  assert.equal(day20.carryoverBeforePeriodCents, 30000);
  assert.equal(day20.dailyCeilingCents, 27272);

  const day21 = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(day21.dailyCeilingCents, 30000);
  assert.ok(day21.dailyCarryoverDeltaCents > 0);
});

test('resgate da reserva não é contabilizado como nova receita', () => {
  const state = makeEmptyState();
  state.transactions.push({
    id: 'sal',
    type: 'receita',
    description: 'Salário',
    amountCents: 200000,
    date: '2026-11-05',
    categoryId: 'cat-sal',
    status: 'pago',
    createdAt: '2026-11-05T10:00:00Z',
  });
  state.reserveMovements.push(
    {
      id: 'res-1',
      type: 'aporte',
      amountCents: 50000,
      date: '2026-11-10',
      description: 'Reserva de emergência',
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 'res-2',
      type: 'resgate',
      amountCents: 20000,
      date: '2026-11-15',
      description: 'Resgate parcial',
      createdAt: '2026-11-15T10:00:00Z',
    }
  );

  assert.equal(calculateReserveBalanceCents(state.reserveMovements), 30000);
  const res = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(res.periodRevenuesCents, 200000);
  assert.equal(res.availableToSpendCents, 170000);
});

test('parcelamento gera até 48 parcelas com soma exata e bloqueia acima de 48', () => {
  const parcels = generateInstallments({
    description: 'Notebook',
    totalAmountCents: 10000,
    installmentsCount: 3,
    purchaseDate: '2026-11-21',
    firstDueDate: '2026-11-25',
    categoryId: 'cat-mor',
    firstInstallmentPaid: true,
  });

  assert.equal(parcels.length, 3);
  assert.equal(
    parcels.reduce((acc, p) => acc + p.amountCents, 0),
    10000
  );
  assert.equal(parcels[0].status, 'pago');
  assert.equal(parcels[1].status, 'pendente');
  assert.equal(parcels[1].date, '2026-12-25');
  assert.equal(parcels[2].date, '2027-01-25');

  const max48 = generateInstallments({
    description: 'Curso',
    totalAmountCents: 480000,
    installmentsCount: 48,
    purchaseDate: '2026-11-21',
    firstDueDate: '2026-11-25',
    categoryId: 'cat-mor',
    firstInstallmentPaid: false,
  });
  assert.equal(max48.length, 48);

  assert.throws(() => {
    generateInstallments({
      description: 'Inválido',
      totalAmountCents: 490000,
      installmentsCount: 49,
      purchaseDate: '2026-11-21',
      firstDueDate: '2026-11-25',
      categoryId: 'cat-mor',
      firstInstallmentPaid: false,
    });
  }, /48/);
});

test('ordenação respeita data, valor e ordem alfabética nesta sequência', () => {
  const txs: Transaction[] = [
    {
      id: '1',
      type: 'despesa',
      description: 'Zebra',
      amountCents: 5000,
      date: '2026-11-20',
      categoryId: 'cat-ali',
      status: 'pago',
      createdAt: '',
    },
    {
      id: '2',
      type: 'despesa',
      description: 'Abacate',
      amountCents: 5000,
      date: '2026-11-20',
      categoryId: 'cat-ali',
      status: 'pago',
      createdAt: '',
    },
    {
      id: '3',
      type: 'despesa',
      description: 'Mercado',
      amountCents: 12000,
      date: '2026-11-20',
      categoryId: 'cat-ali',
      status: 'pago',
      createdAt: '',
    },
    {
      id: '4',
      type: 'despesa',
      description: 'Café',
      amountCents: 1500,
      date: '2026-11-21',
      categoryId: 'cat-ali',
      status: 'pago',
      createdAt: '',
    },
  ];

  const sorted = sortTransactions(txs);
  assert.deepEqual(
    sorted.map((t) => t.id),
    ['4', '3', '2', '1']
  );
});

test('estorno mantém vínculo com movimentação original e zera impacto', () => {
  const original: Transaction = {
    id: 'orig-1',
    type: 'despesa',
    description: 'Compra duplicada',
    amountCents: 15000,
    date: '2026-11-18',
    categoryId: 'cat-ali',
    status: 'pago',
    createdAt: '2026-11-18T10:00:00Z',
  };

  const { updatedOriginal, reversalEntry } = createReversalPair(original, '2026-11-21', 'Cancelado');
  assert.equal(updatedOriginal.status, 'cancelado');
  assert.equal(updatedOriginal.reversedById, reversalEntry.id);
  assert.equal(reversalEntry.relatedTransactionId, original.id);
  assert.equal(reversalEntry.isReversal, true);

  const state = makeEmptyState();
  state.transactions.push(updatedOriginal, reversalEntry);
  const res = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(res.periodExpensesCents, 0);
  assert.equal(res.periodRevenuesCents, 0);
});

test('recorrência expande nos períodos correspondentes sem duplicar materializados', () => {
  const state = makeEmptyState();
  state.recurringRules.push({
    id: 'rec-1',
    type: 'despesa',
    description: 'Internet Fibra',
    amountCents: 11990,
    categoryId: 'cat-mor',
    frequency: 'mensal',
    startDate: '2026-10-10',
    defaultStatus: 'pendente',
    active: true,
    createdAt: '2026-10-01T10:00:00Z',
  });
  state.transactions.push({
    id: 'mat-oct',
    type: 'despesa',
    description: 'Internet Fibra',
    amountCents: 11990,
    date: '2026-10-10',
    categoryId: 'cat-mor',
    status: 'pago',
    recurrenceRuleId: 'rec-1',
    occurrenceKey: 'rec-1::2026-10-10',
    createdAt: '2026-10-10T10:00:00Z',
  });

  const expanded = expandTransactionsThroughDate(state, '2026-12-31');
  const internetTxs = expanded.filter((t) => t.recurrenceRuleId === 'rec-1');
  assert.equal(internetTxs.length, 3);
});

test('detecção de duplicidade, dias não úteis, categorias e formatação PT-BR', () => {
  assert.equal(isNonBusinessDay('2026-11-21'), true);
  assert.equal(isNonBusinessDay('2026-11-20'), true);
  assert.equal(getNextBusinessDayISO('2026-11-20'), '2026-11-23');

  assert.equal(parseCurrencyInputToCents('R$ 1.250,99'), 125099);
  assert.equal(parseCurrencyInputToCents('-10,00'), null);
  assert.equal(formatDateBR('2026-11-21'), '21/11/2026');
  assert.ok(centsToBRL(125099).includes('1.250,99'));

  const existing: Transaction[] = [
    {
      id: 'x1',
      type: 'despesa',
      description: 'Café',
      amountCents: 1200,
      date: '2026-11-21',
      categoryId: 'cat-ali',
      status: 'pago',
      createdAt: '',
    },
  ];
  assert.equal(
    hasDuplicateTransaction(existing, {
      type: 'despesa',
      description: '  café ',
      amountCents: 1200,
      date: '2026-11-21',
    }),
    true
  );

  const cats: Category[] = [{ id: 'cat-ali', name: 'Alimentação', type: 'despesa', color: '#D97706' }];
  const breakdown = calculateCategoryBreakdown(existing, cats, 'despesa');
  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].totalCents, 1200);
  assert.equal(breakdown[0].percentage, 100);
});

test('sugestão inteligente de categoria, consumo semanal, radar de microgastos e Teto IA calculam com dados reais', () => {
  const state = makeEmptyState();
  assert.equal(
    suggestCategoryForDescription('Café & Padaria Express', state.categories, 'despesa'),
    'cat-ali'
  );
  assert.equal(
    suggestCategoryForDescription('Recarga Uber metrô', state.categories, 'despesa'),
    'cat-tra'
  );

  state.transactions.push(
    {
      id: 'r1',
      type: 'receita',
      description: 'Bolsa de Estágio',
      amountCents: 180000,
      date: '2026-11-05',
      categoryId: 'cat-sal',
      status: 'pago',
      createdAt: '',
    },
    {
      id: 'f1',
      type: 'despesa',
      description: 'Aluguel',
      amountCents: 80000,
      date: '2026-11-10',
      categoryId: 'cat-mor',
      status: 'pago',
      budgetKind: 'fixo',
      createdAt: '',
    },
    {
      id: 'v1',
      type: 'despesa',
      description: 'Café',
      amountCents: 1490,
      date: '2026-11-03',
      categoryId: 'cat-ali',
      status: 'pago',
      budgetKind: 'livre',
      createdAt: '',
    },
    {
      id: 'v2',
      type: 'despesa',
      description: 'Delivery',
      amountCents: 4200,
      date: '2026-11-12',
      categoryId: 'cat-ali',
      status: 'pago',
      budgetKind: 'livre',
      createdAt: '',
    },
    {
      id: 'v3',
      type: 'despesa',
      description: 'Uber',
      amountCents: 25310,
      date: '2026-11-20',
      categoryId: 'cat-tra',
      status: 'pago',
      budgetKind: 'livre',
      createdAt: '',
    }
  );
  state.reserveMovements.push({
    id: 'res-nov',
    type: 'aporte',
    amountCents: 20000,
    date: '2026-11-06',
    description: 'Reserva Mensal',
    createdAt: '',
  });

  const ceiling = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(ceiling.plannedFreeCeilingCents, 80000);
  assert.equal(ceiling.availableToSpendCents, 49000);
  assert.equal(ceiling.dailyCeilingCents, 4900); // 49000 / 10 dias = 4900

  const weeks = calculateWeeklyConsumption(
    state,
    '2026-11-01',
    '2026-11-30',
    '2026-11-21',
    ceiling.plannedFreeCeilingCents
  );
  assert.ok(weeks.length >= 4);
  assert.equal(weeks[0].spentCents, 1490);

  const radar = calculateMicrospendingRadar(state.transactions, state.categories, ceiling);
  assert.equal(radar.hasEnoughData, true);
  assert.equal(radar.totalVariableCents, 31000);
  assert.ok(radar.items.length >= 2);

  const ai = analyzeAssistantPrompt('Quero pedir uma pizza de R$ 55', ceiling, state, '2026-11-21');
  assert.equal(ai.amountCents, 5500);
  assert.equal(ai.projectedFreeCents, 43500);
  assert.equal(ai.projectedDailyCents, 4350);
});

import { DEMO_ACCOUNTS } from '../data/seedData';
import { getPeriodRangeForReference } from './formatters';
import { hashPasswordWithSalt, validateAndParseBackupJson } from '../storage/repository';

test('diferenciação entre pago, pendente e cancelado no saldo anterior, saldo atual e teto disponível', () => {
  const state = makeEmptyState();
  state.transactions.push(
    // Período anterior (Outubro): R$ 1.000 pago, R$ 500 pendente (não recebido!), R$ 200 despesa pendente (não paga!)
    {
      id: 'oct-paid-rev',
      type: 'receita',
      description: 'Salário Outubro Confirmado',
      amountCents: 100000,
      date: '2026-10-10',
      categoryId: 'cat-sal',
      status: 'pago',
      createdAt: '2026-10-10T10:00:00Z',
    },
    {
      id: 'oct-pend-rev',
      type: 'receita',
      description: 'Reembolso Pendente Outubro',
      amountCents: 50000,
      date: '2026-10-20',
      categoryId: 'cat-sal',
      status: 'pendente',
      createdAt: '2026-10-20T10:00:00Z',
    },
    {
      id: 'oct-pend-exp',
      type: 'despesa',
      description: 'Conta Pendente Outubro',
      amountCents: 20000,
      date: '2026-10-25',
      categoryId: 'cat-mor',
      status: 'pendente',
      createdAt: '2026-10-25T10:00:00Z',
    },
    // Período atual (Novembro): R$ 2.000 pago, R$ 1.500 receita pendente, R$ 400 despesa paga, R$ 300 despesa pendente, R$ 900 cancelada
    {
      id: 'nov-paid-rev',
      type: 'receita',
      description: 'Salário Novembro Confirmado',
      amountCents: 200000,
      date: '2026-11-05',
      categoryId: 'cat-sal',
      status: 'pago',
      createdAt: '2026-11-05T10:00:00Z',
    },
    {
      id: 'nov-pend-rev',
      type: 'receita',
      description: 'Freela a Receber',
      amountCents: 150000,
      date: '2026-11-18',
      categoryId: 'cat-sal',
      status: 'pendente',
      createdAt: '2026-11-18T10:00:00Z',
    },
    {
      id: 'nov-paid-exp',
      type: 'despesa',
      description: 'Supermercado',
      amountCents: 40000,
      date: '2026-11-10',
      categoryId: 'cat-ali',
      status: 'pago',
      budgetKind: 'livre',
      createdAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 'nov-pend-exp',
      type: 'despesa',
      description: 'Parcela Cartão Novembro',
      amountCents: 30000,
      date: '2026-11-28',
      categoryId: 'cat-mor',
      status: 'pendente',
      budgetKind: 'fixo',
      createdAt: '2026-11-21T10:00:00Z',
    },
    {
      id: 'nov-cancel-exp',
      type: 'despesa',
      description: 'Compra Cancelada',
      amountCents: 90000,
      date: '2026-11-15',
      categoryId: 'cat-ali',
      status: 'cancelado',
      createdAt: '2026-11-15T10:00:00Z',
    },
    // Compromisso futuro (Dezembro)
    {
      id: 'dec-future-exp',
      type: 'despesa',
      description: 'Parcela Dezembro',
      amountCents: 30000,
      date: '2026-12-28',
      categoryId: 'cat-mor',
      status: 'pendente',
      budgetKind: 'fixo',
      createdAt: '2026-11-21T10:00:00Z',
    }
  );

  const res = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');

  // Saldo anterior considera apenas movimentações pagas de outubro (R$ 1.000,00)
  assert.equal(res.carryoverBeforePeriodCents, 100000);
  // Receitas confirmadas no período = R$ 2.000,00; pendente de R$ 1.500,00 fica segregada
  assert.equal(res.periodRevenuesCents, 200000);
  assert.equal(res.periodPendingRevenuesCents, 150000);
  // Saldo em caixa confirmado até 21/11 = 1000 + 2000 - 400 = R$ 2.600,00 (não desconta despesa pendente nem cancelada)
  assert.equal(res.currentCashBalanceCents, 260000);
  // Teto disponível reserva o compromisso pendente de R$ 300,00 do mês: 1000 + 2000 - 400 - 300 = R$ 2.300,00
  assert.equal(res.periodPaidExpensesCents, 40000);
  assert.equal(res.periodPendingExpensesCents, 30000);
  assert.equal(res.availableToSpendCents, 230000);
  // 230000 / 10 dias = 23000 (R$ 230,00/dia)
  assert.equal(res.dailyCeilingCents, 23000);
  // Compromisso futuro de dezembro preservado sem abater o ciclo atual
  assert.equal(res.futureCommitmentsCents, 30000);
  assert.equal(res.futureCommitmentsCount, 1);
});

test('dia de fechamento personalizado 28, alteração retroativa e radar em ciclo futuro', () => {
  const customRange = getPeriodRangeForReference('2026-11-21', 0, 28);
  assert.equal(customRange.start, '2026-10-29');
  assert.equal(customRange.end, '2026-11-28');

  const state = makeEmptyState();
  state.transactions.push({
    id: 'r-nov',
    type: 'receita',
    description: 'Salário',
    amountCents: 100000,
    date: '2026-11-05',
    categoryId: 'cat-sal',
    status: 'pago',
    createdAt: '',
  });
  const beforeRetro = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(beforeRetro.dailyCeilingCents, 10000); // 100000 / 10

  // Lançamento retroativo em outubro reduz o saldo anterior e recalcula novembro
  state.transactions.push({
    id: 'retro-oct',
    type: 'despesa',
    description: 'Ajuste Retroativo Outubro',
    amountCents: 20000,
    date: '2026-10-15',
    categoryId: 'cat-mor',
    status: 'pago',
    createdAt: '',
  });
  const afterRetro = calculateDailyCeiling(state, '2026-11-01', '2026-11-30', '2026-11-21');
  assert.equal(afterRetro.carryoverBeforePeriodCents, -20000);
  assert.equal(afterRetro.availableToSpendCents, 80000);
  assert.equal(afterRetro.dailyCeilingCents, 8000);

  // Mudança de categoria atualiza relatório
  state.transactions[1].categoryId = 'cat-tra';
  const breakdown = calculateCategoryBreakdown(state.transactions, state.categories, 'despesa');
  assert.equal(breakdown[0].categoryId, 'cat-tra');

  // Radar em ciclo futuro (dezembro) com referência em novembro não conta dias cumpridos
  const decCeiling = calculateDailyCeiling(state, '2026-12-01', '2026-12-31', '2026-11-21');
  const futureRadar = calculateMicrospendingRadar([], state.categories, decCeiling);
  assert.equal(futureRadar.daysWithinCeiling, 0);
  assert.equal(futureRadar.estimatedSavingsCents, 0);
});

test('validação de backup JSON e hash de senha sem texto puro', async () => {
  const state = makeEmptyState();
  state.transactions.push({
    id: 'tx-1',
    type: 'despesa',
    description: 'Café',
    amountCents: 1500,
    date: '2026-11-21',
    categoryId: 'cat-ali',
    status: 'pago',
    createdAt: '2026-11-21T10:00:00Z',
  });

  // Backup tentando alterar e-mail da conta ativa deve preservar isolamento do e-mail ativo
  const exported = JSON.stringify({
    ...state,
    profile: { ...state.profile, email: 'outra.conta@evil.com', name: 'Nome Restaurado' },
  });
  const validResult = validateAndParseBackupJson(exported, state.profile);
  assert.equal(validResult.ok, true);
  if (validResult.ok) {
    assert.equal(validResult.workspace.profile.email, 'teste@teto.app');
    assert.equal(validResult.workspace.profile.name, 'Nome Restaurado');
    assert.equal(validResult.summary.transactionsCount, 1);
  }

  // Rejeita JSON inválido ou valor inválido
  const invalidJson = validateAndParseBackupJson('{corrompido', state.profile);
  assert.equal(invalidJson.ok, false);

  const invalidTx = validateAndParseBackupJson(
    JSON.stringify({
      ...state,
      transactions: [{ ...state.transactions[0], amountCents: -100 }],
    }),
    state.profile
  );
  assert.equal(invalidTx.ok, false);

  // Verifica hash das contas demo
  const lucas = DEMO_ACCOUNTS[0];
  const computed = await hashPasswordWithSalt('teto@2026', lucas.passwordSalt);
  assert.equal(computed, lucas.passwordHash);
});

test('recorrências respeitam skippedOccurrenceKeys, endDate e pausa (active=false)', () => {
  const state = makeEmptyState();
  state.recurringRules.push(
    {
      id: 'rec-ativa',
      type: 'despesa',
      description: 'Streaming',
      amountCents: 3990,
      categoryId: 'cat-mor',
      frequency: 'mensal',
      startDate: '2026-10-05',
      endDate: '2026-12-10',
      defaultStatus: 'pendente',
      active: true,
      createdAt: '2026-10-01T10:00:00Z',
    },
    {
      id: 'rec-pausada',
      type: 'despesa',
      description: 'Clube Pausado',
      amountCents: 5000,
      categoryId: 'cat-mor',
      frequency: 'mensal',
      startDate: '2026-10-05',
      defaultStatus: 'pendente',
      active: false,
      createdAt: '2026-10-01T10:00:00Z',
    }
  );
  // Ocorrência de novembro marcada como excluída pelo usuário
  state.skippedOccurrenceKeys.push('rec-ativa::2026-11-05');

  const expanded = expandTransactionsThroughDate(state, '2027-02-01');
  const activeVirtual = expanded.filter((t) => t.recurrenceRuleId === 'rec-ativa');
  const pausedVirtual = expanded.filter((t) => t.recurrenceRuleId === 'rec-pausada');

  // Outubro e Dezembro aparecem; Novembro foi ignorado e Janeiro passou de endDate
  assert.deepEqual(
    activeVirtual.map((t) => t.date),
    ['2026-10-05', '2026-12-05']
  );
  assert.equal(pausedVirtual.length, 0);
});

test('evolução diária, travas de estorno e validação completa de parcelamentos (12x e limites)', () => {
  const state = makeEmptyState();
  state.transactions.push(
    {
      id: 'evo-r',
      type: 'receita',
      description: 'Salário',
      amountCents: 100000,
      date: '2026-11-01',
      categoryId: 'cat-sal',
      status: 'pago',
      createdAt: '',
    },
    {
      id: 'evo-d',
      type: 'despesa',
      description: 'Mercado',
      amountCents: 10000,
      date: '2026-11-02',
      categoryId: 'cat-ali',
      status: 'pago',
      createdAt: '',
    }
  );
  state.reserveMovements.push({
    id: 'evo-res',
    type: 'aporte',
    amountCents: 20000,
    date: '2026-11-03',
    description: 'Aporte Reserva',
    createdAt: '',
  });

  const evo = calculateDailyEvolution(state, '2026-11-01', '2026-11-05');
  assert.equal(evo.length, 5);
  assert.equal(evo[0].cumulativeBalanceCents, 100000);
  assert.equal(evo[1].cumulativeBalanceCents, 90000);
  assert.equal(evo[2].cumulativeBalanceCents, 70000);
  assert.equal(evo[2].projectedCeilingCents, 23333); // 70000 / 3 dias truncado

  // Parcelamento 12x de R$ 100,00 (10000 centavos = 4x834 + 8x833)
  const p12 = generateInstallments({
    description: 'Fone',
    totalAmountCents: 10000,
    installmentsCount: 12,
    purchaseDate: '2026-11-21',
    firstDueDate: '2026-11-21',
    categoryId: 'cat-mor',
    firstInstallmentPaid: true,
  });
  assert.equal(p12.length, 12);
  assert.equal(
    p12.reduce((acc, p) => acc + p.amountCents, 0),
    10000
  );
  assert.equal(p12[0].amountCents, 834);
  assert.equal(p12[11].amountCents, 833);

  assert.throws(() =>
    generateInstallments({
      description: 'Inválido 1x',
      totalAmountCents: 1000,
      installmentsCount: 1,
      purchaseDate: '2026-11-21',
      firstDueDate: '2026-11-21',
      categoryId: 'cat-mor',
      firstInstallmentPaid: true,
    })
  );

  // Travas de estorno (não permite re-estornar estorno ou item cancelado)
  const { updatedOriginal, reversalEntry } = createReversalPair(state.transactions[1], '2026-11-21');
  assert.throws(() => createReversalPair(updatedOriginal, '2026-11-21'));
  assert.throws(() => createReversalPair(reversalEntry, '2026-11-21'));
});

