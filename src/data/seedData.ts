import { addDaysISO, addMonthsISO, getPeriodRangeForReference, getTodayISO } from '../domain/formatters';
import type { Category, LocalAccount, WorkspaceState } from '../domain/types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-salario', name: 'Salário', type: 'receita', color: '#10B981', icon: 'payments', isDefault: true },
  { id: 'cat-freelance', name: 'Renda Extra', type: 'receita', color: '#0D9488', icon: 'trending_up', isDefault: true },
  { id: 'cat-alimentacao', name: 'Alimentação', type: 'despesa', color: '#E53935', icon: 'restaurant', isDefault: true },
  { id: 'cat-transporte', name: 'Transporte', type: 'despesa', color: '#F59E0B', icon: 'directions_car', isDefault: true },
  { id: 'cat-lazer', name: 'Lazer & Outros', type: 'despesa', color: '#FF4D4D', icon: 'shopping_bag', isDefault: true },
  { id: 'cat-moradia', name: 'Moradia', type: 'despesa', color: '#6366F1', icon: 'home', isDefault: true },
  { id: 'cat-assinaturas', name: 'Assinaturas', type: 'despesa', color: '#0284C7', icon: 'subscriptions', isDefault: true },
  { id: 'cat-saude', name: 'Saúde', type: 'despesa', color: '#EC4899', icon: 'favorite', isDefault: true },
  { id: 'cat-educacao', name: 'Educação', type: 'despesa', color: '#8B5CF6', icon: 'school', isDefault: true },
  { id: 'cat-outros', name: 'Outros', type: 'ambos', color: '#9CA3AF', icon: 'category', isDefault: true },
];

export const DEMO_ACCOUNTS: LocalAccount[] = [
  {
    id: 'demo-lucas',
    name: 'Lucas Gabriel',
    email: 'lucas.gabriel@email.com',
    passwordSalt: 'teto_demo_lucas_salt',
    passwordHash: 'd61b0111b273cad642eb3fcbb5521be3f504e41706887d890f14dce00f012005',
    roleLabel: 'Estagiário de Tecnologia • Desconectado Impulsivo',
    isDemo: true,
  },
  {
    id: 'demo-beatriz',
    name: 'Beatriz Souza',
    email: 'beatriz.souza@email.com',
    passwordSalt: 'teto_demo_beatriz_salt',
    passwordHash: '03cc0505c9005216c9f2a493b1ab7fa722c8190b9af8336a6becad1e2ecbf19e',
    roleLabel: 'Analista de Produto • Planejadora',
    isDemo: true,
  },
];

export function createEmptyWorkspace(overrides?: {
  name?: string;
  email?: string;
  roleLabel?: string;
}): WorkspaceState {
  return {
    version: 2,
    isDemoData: false,
    transactions: [],
    recurringRules: [],
    skippedOccurrenceKeys: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    reserveMovements: [],
    goals: [],
    profile: {
      name: overrides?.name ?? 'Novo Usuário',
      roleLabel: overrides?.roleLabel ?? 'Orçamento Pessoal',
      email: overrides?.email ?? 'usuario@teto.app',
      monthlyNetIncomeCents: 0,
      monthlyFixedExpensesCents: 0,
      monthlyReserveGoalCents: 0,
      emergencyReserveTargetCents: 300000,
      plan: 'free',
      proactiveAlerts: true,
      biometricLock: false,
      level: 1,
    },
    settings: { cycleClosingDay: 0 },
  };
}

function clampInPeriod(start: string, end: string, dayOffset: number): string {
  const candidate = addDaysISO(start, dayOffset);
  return candidate > end ? end : candidate;
}

export function createLucasDemoWorkspace(referenceDate: string = getTodayISO()): WorkspaceState {
  const { start, end } = getPeriodRangeForReference(referenceDate, 0, 0);
  const prevMonthDate = addMonthsISO(start, -1);
  const todayOrMid = referenceDate >= start && referenceDate <= end ? referenceDate : clampInPeriod(start, end, 14);
  const yesterday = addDaysISO(todayOrMid, -1) >= start ? addDaysISO(todayOrMid, -1) : start;
  const week1Day = clampInPeriod(start, end, 2);
  const week2Day = clampInPeriod(start, end, 10);
  const payDay = clampInPeriod(start, end, 4);
  const reserveDay = clampInPeriod(start, end, 5);
  const rentDay = clampInPeriod(start, end, 7);
  const nowIso = new Date().toISOString();

  return {
    version: 2,
    isDemoData: true,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { cycleClosingDay: 0 },
    skippedOccurrenceKeys: [],
    profile: {
      name: 'Lucas Gabriel',
      roleLabel: 'Estagiário de Tecnologia',
      email: 'lucas.gabriel@email.com',
      monthlyNetIncomeCents: 180000, // R$ 1.800,00
      monthlyFixedExpensesCents: 80000, // R$ 800,00
      monthlyReserveGoalCents: 20000, // R$ 200,00
      emergencyReserveTargetCents: 540000, // R$ 5.400,00
      plan: 'free',
      proactiveAlerts: true,
      biometricLock: true,
      level: 2,
    },
    recurringRules: [
      {
        id: 'rec-bolsa-lucas',
        type: 'receita',
        description: 'Bolsa de Estágio Tech',
        amountCents: 180000,
        categoryId: 'cat-salario',
        frequency: 'mensal',
        startDate: addDaysISO(prevMonthDate, 4),
        defaultStatus: 'pago',
        active: true,
        createdAt: nowIso,
      },
      {
        id: 'rec-aluguel-lucas',
        type: 'despesa',
        description: 'Aluguel e Contas Fixas',
        amountCents: 65800,
        categoryId: 'cat-moradia',
        budgetKind: 'fixo',
        frequency: 'mensal',
        startDate: addDaysISO(prevMonthDate, 7),
        defaultStatus: 'pago',
        active: true,
        createdAt: nowIso,
      },
      {
        id: 'rec-internet-lucas',
        type: 'despesa',
        description: 'Internet Fibra & Celular',
        amountCents: 12000,
        categoryId: 'cat-assinaturas',
        budgetKind: 'fixo',
        frequency: 'mensal',
        startDate: addDaysISO(prevMonthDate, 9),
        defaultStatus: 'pago',
        active: true,
        createdAt: nowIso,
      },
    ],
    transactions: [
      // Saldo anterior exatamente equilibrado com a reserva anterior de R$ 1.250,00
      {
        id: 'lucas-prev-bolsa',
        type: 'receita',
        description: 'Bolsa de Estágio Tech',
        amountCents: 180000,
        date: addDaysISO(prevMonthDate, 4),
        categoryId: 'cat-salario',
        status: 'pago',
        paymentMethodLabel: 'Transferência',
        recurrenceRuleId: 'rec-bolsa-lucas',
        occurrenceKey: `rec-bolsa-lucas::${addDaysISO(prevMonthDate, 4)}`,
        createdAt: nowIso,
      },
      {
        id: 'lucas-prev-freela',
        type: 'receita',
        description: 'Freela Front-end (Mês Anterior)',
        amountCents: 125000,
        date: addDaysISO(prevMonthDate, 12),
        categoryId: 'cat-freelance',
        status: 'pago',
        paymentMethodLabel: 'Pix',
        createdAt: nowIso,
      },
      {
        id: 'lucas-prev-aluguel',
        type: 'despesa',
        description: 'Aluguel e Contas Fixas',
        amountCents: 65800,
        date: addDaysISO(prevMonthDate, 7),
        categoryId: 'cat-moradia',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Débito Automático',
        recurrenceRuleId: 'rec-aluguel-lucas',
        occurrenceKey: `rec-aluguel-lucas::${addDaysISO(prevMonthDate, 7)}`,
        createdAt: nowIso,
      },
      {
        id: 'lucas-prev-internet',
        type: 'despesa',
        description: 'Internet Fibra & Celular',
        amountCents: 12000,
        date: addDaysISO(prevMonthDate, 9),
        categoryId: 'cat-assinaturas',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Fatura',
        recurrenceRuleId: 'rec-internet-lucas',
        occurrenceKey: `rec-internet-lucas::${addDaysISO(prevMonthDate, 9)}`,
        createdAt: nowIso,
      },
      {
        id: 'lucas-prev-gastos',
        type: 'despesa',
        description: 'Mercado & Lazer (Mês Anterior)',
        amountCents: 102200,
        date: addDaysISO(prevMonthDate, 20),
        categoryId: 'cat-alimentacao',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'Cartão',
        createdAt: nowIso,
      },

      // Mês atual: Renda R$ 1.800,00 | Fixos R$ 800,00 | Variáveis R$ 310,00 | Reserva R$ 200,00 => Teto Livre R$ 490,00
      {
        id: 'lucas-cur-bolsa',
        type: 'receita',
        description: 'Bolsa de Estágio Tech',
        amountCents: 180000,
        date: payDay,
        categoryId: 'cat-salario',
        status: 'pago',
        paymentMethodLabel: 'Salário',
        recurrenceRuleId: 'rec-bolsa-lucas',
        occurrenceKey: `rec-bolsa-lucas::${payDay}`,
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-aluguel',
        type: 'despesa',
        description: 'Aluguel e Contas Fixas',
        amountCents: 65800,
        date: rentDay,
        categoryId: 'cat-moradia',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Débito Automático',
        recurrenceRuleId: 'rec-aluguel-lucas',
        occurrenceKey: `rec-aluguel-lucas::${rentDay}`,
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-internet',
        type: 'despesa',
        description: 'Internet Fibra & Celular',
        amountCents: 12000,
        date: clampInPeriod(start, end, 9),
        categoryId: 'cat-assinaturas',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Fatura',
        recurrenceRuleId: 'rec-internet-lucas',
        occurrenceKey: `rec-internet-lucas::${clampInPeriod(start, end, 9)}`,
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-transporte',
        type: 'despesa',
        description: 'Recarga Transporte',
        amountCents: 2200, // 658 + 120 + 22 = R$ 800,00 de gastos fixos!
        date: todayOrMid,
        categoryId: 'cat-transporte',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Aproximação',
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-cafe',
        type: 'despesa',
        description: 'Café & Padaria Express',
        amountCents: 1490,
        date: todayOrMid,
        categoryId: 'cat-alimentacao',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'Pix Manual',
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-delivery',
        type: 'despesa',
        description: 'Delivery Restaurante',
        amountCents: 4200,
        date: yesterday,
        categoryId: 'cat-lazer',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'iFood',
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-mercado',
        type: 'despesa',
        description: 'Supermercado Semanal',
        amountCents: 18510,
        date: week2Day,
        categoryId: 'cat-alimentacao',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'Débito',
        createdAt: nowIso,
      },
      {
        id: 'lucas-cur-uber',
        type: 'despesa',
        description: 'Uber & Conveniência',
        amountCents: 6800, // 14,90 + 42,00 + 185,10 + 68,00 = R$ 310,00 livres gastos!
        date: week1Day,
        categoryId: 'cat-transporte',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'App',
        createdAt: nowIso,
      },
    ],
    reserveMovements: [
      {
        id: 'lucas-res-anterior',
        type: 'aporte',
        amountCents: 125000, // R$ 1.250,00 anteriores
        date: addDaysISO(prevMonthDate, 6),
        description: 'Reserva Acumulada Inicial',
        createdAt: nowIso,
      },
      {
        id: 'lucas-res-atual',
        type: 'aporte',
        amountCents: 20000, // R$ 200,00 este mês => Total R$ 1.450,00
        date: reserveDay,
        description: 'Meta Mensal Automática (Reserva Futura)',
        createdAt: nowIso,
      },
    ],
    goals: [
      {
        id: 'goal-viagem',
        title: 'Viagem de Fim de Ano',
        targetCents: 120000,
        savedCents: 80000,
        deadlineLabel: 'Dezembro 2026',
        icon: 'flight_takeoff',
        createdAt: nowIso,
      },
      {
        id: 'goal-notebook',
        title: 'Novo Notebook de Trabalho',
        targetCents: 350000,
        savedCents: 160000,
        deadlineLabel: 'Março 2027',
        icon: 'laptop_mac',
        createdAt: nowIso,
      },
    ],
  };
}

export function createBeatrizDemoWorkspace(referenceDate: string = getTodayISO()): WorkspaceState {
  const { start, end } = getPeriodRangeForReference(referenceDate, 0, 0);
  const prevMonthDate = addMonthsISO(start, -1);
  const todayOrMid = referenceDate >= start && referenceDate <= end ? referenceDate : clampInPeriod(start, end, 14);
  const yesterday = addDaysISO(todayOrMid, -1) >= start ? addDaysISO(todayOrMid, -1) : start;
  const nowIso = new Date().toISOString();

  return {
    version: 2,
    isDemoData: true,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { cycleClosingDay: 0 },
    skippedOccurrenceKeys: [],
    profile: {
      name: 'Beatriz Souza',
      roleLabel: 'Analista de Produto',
      email: 'beatriz.souza@email.com',
      monthlyNetIncomeCents: 420000, // R$ 4.200,00
      monthlyFixedExpensesCents: 195000, // R$ 1.950,00
      monthlyReserveGoalCents: 60000, // R$ 600,00
      emergencyReserveTargetCents: 1200000, // R$ 12.000,00
      plan: 'premium',
      proactiveAlerts: true,
      biometricLock: false,
      level: 4,
    },
    recurringRules: [
      {
        id: 'rec-sal-bia',
        type: 'receita',
        description: 'Salário Produto Tech',
        amountCents: 420000,
        categoryId: 'cat-salario',
        frequency: 'mensal',
        startDate: addDaysISO(prevMonthDate, 4),
        defaultStatus: 'pago',
        active: true,
        createdAt: nowIso,
      },
    ],
    transactions: [
      {
        id: 'bia-sal-cur',
        type: 'receita',
        description: 'Salário Produto Tech',
        amountCents: 420000,
        date: clampInPeriod(start, end, 4),
        categoryId: 'cat-salario',
        status: 'pago',
        paymentMethodLabel: 'TED',
        recurrenceRuleId: 'rec-sal-bia',
        occurrenceKey: `rec-sal-bia::${clampInPeriod(start, end, 4)}`,
        createdAt: nowIso,
      },
      {
        id: 'bia-aluguel',
        type: 'despesa',
        description: 'Apartamento & Condomínio',
        amountCents: 165000,
        date: clampInPeriod(start, end, 8),
        categoryId: 'cat-moradia',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Débito Automático',
        createdAt: nowIso,
      },
      {
        id: 'bia-fixo-saude',
        type: 'despesa',
        description: 'Plano & Academia',
        amountCents: 30000,
        date: clampInPeriod(start, end, 10),
        categoryId: 'cat-saude',
        status: 'pago',
        budgetKind: 'fixo',
        paymentMethodLabel: 'Cartão',
        createdAt: nowIso,
      },
      {
        id: 'bia-mercado',
        type: 'despesa',
        description: 'Hortifruti & Mercado',
        amountCents: 38500,
        date: yesterday,
        categoryId: 'cat-alimentacao',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'Pix',
        createdAt: nowIso,
      },
      {
        id: 'bia-cafe',
        type: 'despesa',
        description: 'Cafeteria Especial',
        amountCents: 2800,
        date: todayOrMid,
        categoryId: 'cat-alimentacao',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'Aproximação',
        createdAt: nowIso,
      },
      {
        id: 'bia-lazer',
        type: 'despesa',
        description: 'Cinema & Jantar',
        amountCents: 13700,
        date: clampInPeriod(start, end, 6),
        categoryId: 'cat-lazer',
        status: 'pago',
        budgetKind: 'livre',
        paymentMethodLabel: 'Crédito',
        createdAt: nowIso,
      },
    ],
    reserveMovements: [
      {
        id: 'bia-res-1',
        type: 'aporte',
        amountCents: 60000,
        date: clampInPeriod(start, end, 5),
        description: 'Aporte Mensal Planejado',
        createdAt: nowIso,
      },
    ],
    goals: [
      {
        id: 'goal-bia-1',
        title: 'Pós-Graduação em Dados',
        targetCents: 850000,
        savedCents: 420000,
        deadlineLabel: 'Agosto 2027',
        icon: 'school',
        createdAt: nowIso,
      },
    ],
  };
}

export function createDemoWorkspaceForAccount(
  accountId: string,
  referenceDate: string = getTodayISO()
): WorkspaceState {
  if (accountId === 'demo-beatriz') {
    return createBeatrizDemoWorkspace(referenceDate);
  }
  return createLucasDemoWorkspace(referenceDate);
}

export const createDemoWorkspace = createLucasDemoWorkspace;
