export type TransactionType = 'receita' | 'despesa';

export type TransactionStatus = 'pago' | 'pendente' | 'cancelado';

export type RecurrenceFrequency = 'semanal' | 'quinzenal' | 'mensal' | 'anual';

export type PlanTier = 'free' | 'premium';

export type ExpenseBudgetKind = 'livre' | 'fixo';

export interface Category {
  id: string;
  name: string;
  type: TransactionType | 'ambos';
  color: string;
  icon?: string;
  isDefault?: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  description: string;
  amountCents: number;
  date: string; // YYYY-MM-DD (data efetiva / vencimento)
  purchaseDate?: string; // YYYY-MM-DD (data original da compra parcelada)
  categoryId: string;
  status: TransactionStatus;
  budgetKind?: ExpenseBudgetKind;
  paymentMethodLabel?: string;
  installmentGroupId?: string;
  installmentNumber?: number;
  totalInstallments?: number;
  recurrenceRuleId?: string;
  occurrenceKey?: string; // `${ruleId}::${YYYY-MM-DD}`
  isVirtualRecurring?: boolean;
  isReversal?: boolean;
  relatedTransactionId?: string; // ID da movimentação original (para estornos)
  reversedById?: string; // ID do estorno vinculado
  notes?: string;
  createdAt: string;
}

export interface RecurringRule {
  id: string;
  type: TransactionType;
  description: string;
  amountCents: number;
  categoryId: string;
  budgetKind?: ExpenseBudgetKind;
  frequency: RecurrenceFrequency;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  defaultStatus: 'pago' | 'pendente';
  active: boolean;
  createdAt: string;
}

export type ReserveMovementType = 'aporte' | 'resgate';

export interface ReserveMovement {
  id: string;
  type: ReserveMovementType;
  amountCents: number;
  date: string; // YYYY-MM-DD
  description: string;
  goalId?: string;
  createdAt: string;
}

export interface Goal {
  id: string;
  title: string;
  targetCents: number;
  savedCents: number;
  deadlineLabel: string;
  icon: string;
  createdAt: string;
}

export interface BudgetProfile {
  name: string;
  roleLabel: string;
  email: string;
  monthlyNetIncomeCents: number;
  monthlyFixedExpensesCents: number;
  monthlyReserveGoalCents: number;
  emergencyReserveTargetCents: number;
  plan: PlanTier;
  proactiveAlerts: boolean;
  biometricLock: boolean;
  level: number;
}

export interface PeriodSettings {
  cycleClosingDay: number; // 0 = fim do mês calendário; 1..28 = dia de fechamento personalizado
}

export interface WorkspaceState {
  version: number;
  isDemoData: boolean;
  transactions: Transaction[];
  recurringRules: RecurringRule[];
  skippedOccurrenceKeys: string[];
  categories: Category[];
  reserveMovements: ReserveMovement[];
  goals: Goal[];
  profile: BudgetProfile;
  settings: PeriodSettings;
}

export interface LocalAccount {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  roleLabel: string;
  isDemo: boolean;
}

export interface AppSession {
  accountId: string;
  rememberMe: boolean;
  authenticatedAt: string;
}

export interface DailyCeilingResult {
  periodStart: string;
  periodEnd: string;
  referenceDate: string;
  totalDaysInPeriod: number;
  remainingDays: number; // Inclui o dia atual
  isPeriodClosed: boolean;
  carryoverBeforePeriodCents: number;
  periodRevenuesCents: number;
  periodPendingRevenuesCents: number;
  periodExpensesCents: number;
  periodFixedExpensesCents: number;
  periodVariableExpensesCents: number;
  periodPaidExpensesCents: number;
  periodPendingExpensesCents: number;
  periodReserveNetCents: number;
  plannedFreeCeilingCents: number;
  availableToSpendCents: number;
  currentCashBalanceCents: number;
  dailyCeilingCents: number; // Truncado em 2 casas decimais; 0 se negativo/insuficiente
  previousDayCeilingCents: number;
  dailyCarryoverDeltaCents: number;
  isDeficit: boolean;
  futureCommitmentsCents: number;
  futureCommitmentsCount: number;
  healthStatus: 'saudavel' | 'atencao' | 'critico';
}

export interface CategorySummary {
  categoryId: string;
  categoryName: string;
  color: string;
  type: TransactionType | 'ambos';
  totalCents: number;
  paidCents: number;
  pendingCents: number;
  count: number;
  percentage: number;
}

export interface DailyEvolutionPoint {
  date: string;
  label: string;
  revenuesCents: number;
  expensesCents: number;
  cumulativeBalanceCents: number;
  projectedCeilingCents: number;
}

export interface WeeklyConsumptionRow {
  weekNumber: number;
  label: string;
  spentCents: number;
  targetCents: number;
  percentage: number;
  withinLimit: boolean;
  isCurrent: boolean;
}

export interface MicrospendingCategoryItem {
  label: string;
  amountCents: number;
  percentage: number;
}

export interface MicrospendingRadarData {
  hasEnoughData: boolean;
  variableExpensesCount: number;
  totalVariableCents: number;
  peakWindowLabel: string;
  daysWithinCeiling: number;
  estimatedSavingsCents: number;
  items: MicrospendingCategoryItem[];
}

export interface AssistantAnalysis {
  replyText: string;
  decisionTitle?: string;
  amountCents?: number;
  daysImpactText?: string;
  impactBarPercent?: number;
  projectedFreeCents?: number;
  projectedDailyCents?: number;
  decisionSummary?: string;
  suggestedDescription?: string;
  suggestedCategoryId?: string;
}
