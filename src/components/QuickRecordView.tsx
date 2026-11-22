import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  generateInstallments,
  hasDuplicateTransaction,
  MAX_INSTALLMENTS,
  suggestCategoryForDescription,
  truncateCentsPerDay,
} from '../domain/ceilingEngine';
import {
  centsToBRL,
  centsToInputString,
  formatDateBR,
  getNextBusinessDayISO,
  getNonBusinessDayReason,
  getTodayISO,
  isValidISODate,
  parseCurrencyInputToCents,
} from '../domain/formatters';
import type {
  Category,
  DailyCeilingResult,
  ExpenseBudgetKind,
  RecurrenceFrequency,
  RecurringRule,
  Transaction,
  TransactionType,
} from '../domain/types';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

export interface QuickRecordDraft {
  type?: TransactionType;
  description?: string;
  amountCents?: number;
  categoryId?: string;
  budgetKind?: ExpenseBudgetKind;
  openScanner?: boolean;
}

interface QuickRecordViewProps {
  categories: Category[];
  existingTransactions: Transaction[];
  ceiling: DailyCeilingResult;
  editingTransaction: Transaction | null;
  initialDraft: QuickRecordDraft | null;
  onNavigate: (view: AppView) => void;
  onSaveSingleOrEdit: (payload: {
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
    forceDuplicate?: boolean;
    applyToPendingGroup?: boolean;
  }) => void;
  onSaveInstallments: (installments: Transaction[]) => void;
  onSaveRecurringRule: (rule: Omit<RecurringRule, 'id' | 'createdAt'>) => void;
  onRequestDelete?: (tx: Transaction) => void;
  onRequestDeleteInstallmentGroup?: (groupId: string, label: string) => void;
  toasts: ToastNotice[];
}

type EntryMode = 'unica' | 'parcelada' | 'recorrente';

export function QuickRecordView({
  categories,
  existingTransactions,
  ceiling,
  editingTransaction,
  initialDraft,
  onNavigate,
  onSaveSingleOrEdit,
  onSaveInstallments,
  onSaveRecurringRule,
  onRequestDelete,
  onRequestDeleteInstallmentGroup,
  toasts,
}: QuickRecordViewProps) {
  const isEditing = Boolean(editingTransaction);
  const isEditingInstallment = Boolean(editingTransaction?.installmentGroupId);

  const [type, setType] = useState<TransactionType>(
    editingTransaction?.type ?? initialDraft?.type ?? 'despesa'
  );
  const [mode, setMode] = useState<EntryMode>('unica');
  const [amountInput, setAmountInput] = useState<string>(
    editingTransaction
      ? centsToInputString(editingTransaction.amountCents)
      : initialDraft?.amountCents
      ? centsToInputString(initialDraft.amountCents)
      : '34,50'
  );
  const [description, setDescription] = useState<string>(
    editingTransaction?.description ?? initialDraft?.description ?? ''
  );
  const [categoryId, setCategoryId] = useState<string>(
    editingTransaction?.categoryId ?? initialDraft?.categoryId ?? 'cat-alimentacao'
  );
  const [manualCategoryLock, setManualCategoryLock] = useState<boolean>(
    Boolean(editingTransaction || initialDraft?.categoryId)
  );
  const [budgetKind, setBudgetKind] = useState<ExpenseBudgetKind>(
    editingTransaction?.budgetKind ?? initialDraft?.budgetKind ?? 'livre'
  );
  const [date, setDate] = useState<string>(editingTransaction?.date ?? getTodayISO());
  const [status, setStatus] = useState<'pago' | 'pendente'>(
    editingTransaction?.status === 'pendente' ? 'pendente' : 'pago'
  );
  const [applyToPendingGroup, setApplyToPendingGroup] = useState<boolean>(false);

  // Parcelamento
  const [installmentsCount, setInstallmentsCount] = useState<string>('3');
  const [purchaseDate, setPurchaseDate] = useState<string>(getTodayISO());

  // Recorrência
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('mensal');
  const [endDate, setEndDate] = useState<string>('');

  // OCR Demonstrativo
  const [scannerOpen, setScannerOpen] = useState<boolean>(Boolean(initialDraft?.openScanner));

  // Validação e confirmação de duplicata
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState<boolean>(false);

  const eligibleCategories = useMemo(
    () => categories.filter((c) => c.type === type || c.type === 'ambos'),
    [categories, type]
  );

  // Garante categoria válida ao trocar tipo
  useEffect(() => {
    if (!eligibleCategories.some((c) => c.id === categoryId)) {
      const first = eligibleCategories[0];
      if (first) setCategoryId(first.id);
    }
  }, [eligibleCategories, categoryId]);

  // Sugestão automática pela descrição
  useEffect(() => {
    if (manualCategoryLock || isEditing) return;
    const suggested = suggestCategoryForDescription(description, categories, type);
    if (suggested) {
      setCategoryId(suggested);
    }
  }, [description, categories, type, manualCategoryLock, isEditing]);

  const parsedAmountCents = useMemo(() => parseCurrencyInputToCents(amountInput, true), [amountInput]);

  // Impacto em tempo real no Teto Livre e Teto Diário (respeitando ciclo e regra de caixa para receitas)
  const impactPreview = useMemo(() => {
    const val = parsedAmountCents ?? 0;
    const nInst = Number(installmentsCount);
    const effectiveImpact =
      mode === 'parcelada' && Number.isInteger(nInst) && nInst >= 2
        ? Math.floor(val / nInst)
        : val;

    let baseAvailable = ceiling.availableToSpendCents;
    if (editingTransaction && editingTransaction.status !== 'cancelado' && !editingTransaction.isReversal) {
      const oldInPeriod =
        editingTransaction.date >= ceiling.periodStart &&
        editingTransaction.date <= ceiling.periodEnd;
      if (oldInPeriod) {
        if (editingTransaction.type === 'despesa') {
          baseAvailable += editingTransaction.amountCents;
        } else if (editingTransaction.status === 'pago') {
          baseAvailable -= editingTransaction.amountCents;
        }
      }
    }

    const newInPeriod =
      isValidISODate(date) && date >= ceiling.periodStart && date <= ceiling.periodEnd;
    const affectsCurrentCeiling =
      newInPeriod && (type === 'despesa' || (type === 'receita' && status === 'pago'));

    const projectedAvailable = affectsCurrentCeiling
      ? type === 'despesa'
        ? baseAvailable - effectiveImpact
        : baseAvailable + effectiveImpact
      : baseAvailable;

    const projectedDaily =
      ceiling.remainingDays > 0
        ? truncateCentsPerDay(projectedAvailable, ceiling.remainingDays)
        : 0;

    return {
      projectedAvailable,
      projectedDaily,
      affectsCurrentCeiling,
      newInPeriod,
    };
  }, [parsedAmountCents, mode, installmentsCount, editingTransaction, ceiling, type, date, status]);

  const nonBusinessReason = useMemo(() => getNonBusinessDayReason(date), [date]);
  const nextBusinessDay = useMemo(() => getNextBusinessDayISO(date), [date]);

  const isDuplicate = useMemo(() => {
    if (!parsedAmountCents || !description.trim() || !isValidISODate(date)) return false;
    return hasDuplicateTransaction(existingTransactions, {
      type,
      description,
      amountCents: parsedAmountCents,
      date,
      excludeId: editingTransaction?.id,
    });
  }, [parsedAmountCents, description, date, existingTransactions, type, editingTransaction]);

  const applySampleReceipt = (sample: {
    desc: string;
    amount: string;
    cat: string;
    kind: ExpenseBudgetKind;
  }) => {
    setType('despesa');
    setDescription(sample.desc);
    setAmountInput(sample.amount);
    setBudgetKind(sample.kind);
    const foundCat = categories.find((c) => c.id === sample.cat);
    if (foundCat) {
      setCategoryId(foundCat.id);
      setManualCategoryLock(true);
    }
    setScannerOpen(false);
    setErrorMsg(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!parsedAmountCents || parsedAmountCents <= 0) {
      setErrorMsg('Informe um valor válido maior que R$ 0,00.');
      return;
    }

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      setErrorMsg('Informe uma descrição ou estabelecimento para registrar.');
      return;
    }

    if (!isValidISODate(date)) {
      setErrorMsg('Informe uma data válida.');
      return;
    }

    if (mode === 'parcelada' && !isEditing) {
      const count = Number(installmentsCount);
      if (!Number.isInteger(count) || count < 2 || count > MAX_INSTALLMENTS) {
        setErrorMsg(`O parcelamento deve ter entre 2 e ${MAX_INSTALLMENTS} parcelas.`);
        return;
      }
      if (!isValidISODate(purchaseDate)) {
        setErrorMsg('Informe uma data da compra válida.');
        return;
      }
      const generated = generateInstallments({
        description: trimmedDesc,
        totalAmountCents: parsedAmountCents,
        installmentsCount: count,
        purchaseDate,
        firstDueDate: date,
        categoryId,
        budgetKind,
        firstInstallmentPaid: status === 'pago',
        existingTransactions,
      });
      onSaveInstallments(generated);
      return;
    }

    if (mode === 'recorrente' && !isEditing) {
      if (endDate && (!isValidISODate(endDate) || endDate < date)) {
        setErrorMsg('A data final da recorrência deve ser igual ou posterior à data inicial.');
        return;
      }
      onSaveRecurringRule({
        type,
        description: trimmedDesc,
        amountCents: parsedAmountCents,
        categoryId,
        budgetKind: type === 'despesa' ? budgetKind : undefined,
        frequency,
        startDate: date,
        endDate: endDate || undefined,
        defaultStatus: status,
        active: true,
      });
      return;
    }

    if (isDuplicate && !confirmDuplicate) {
      setConfirmDuplicate(true);
      return;
    }

    onSaveSingleOrEdit({
      editingId: editingTransaction?.id,
      type,
      description: trimmedDesc,
      amountCents: parsedAmountCents,
      date,
      categoryId,
      budgetKind: type === 'despesa' ? budgetKind : undefined,
      status,
      paymentMethodLabel:
        editingTransaction?.paymentMethodLabel ?? (type === 'receita' ? 'Entrada' : 'Registro Rápido'),
      forceDuplicate: confirmDuplicate,
      applyToPendingGroup: isEditingInstallment ? applyToPendingGroup : undefined,
    });
  };

  return (
    <StitchShell
      activeView="quick-record"
      onNavigate={onNavigate}
      showBack
      backTo="dashboard"
      showBottomNav={false}
      title={
        isEditing
          ? 'Editar Movimentação'
          : type === 'receita'
          ? 'Registrar Receita'
          : 'Registrar Despesa'
      }
      subtitle="Lançamento manual ou leitura demonstrativa de cupom"
      toasts={toasts}
    >
      <div className="max-w-[680px] mx-auto w-full space-y-4">
      {/* Smart Assistant Scanner Pill */}
      {!isEditing && (
        <section className="p-4 rounded-DEFAULT bg-gradient-to-r from-dark-surface-variant via-dark-surface-variant to-[#20181A] border border-primary/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-primary-container text-primary flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-xl">auto_awesome</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-headline text-label-md font-bold text-dark-on-surface">
                  Sugestão Local
                </span>
                <span className="px-1.5 py-0.2 rounded bg-primary/20 text-accent text-[9px] font-bold uppercase">
                  Leitor Demo
                </span>
              </div>
              <p className="text-body-sm text-dark-on-surface-variant text-[11px] mt-0.5 truncate">
                Sugere categoria por palavras-chave e calcula impacto no teto
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Escanear comprovante"
            className="w-9 h-9 rounded-full bg-dark-surface border border-dark-outline flex items-center justify-center text-dark-on-surface hover:text-accent hover:border-primary/50 transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined text-lg">document_scanner</span>
          </button>
        </section>
      )}

      {isEditing && isEditingInstallment && editingTransaction && (
        <section className="p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-primary/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs space-y-0.5">
            <p className="font-bold text-dark-on-surface">
              Compra Parcelada • Parcela {editingTransaction.installmentNumber ?? 1} de{' '}
              {editingTransaction.totalInstallments ?? '?'}
            </p>
            {editingTransaction.purchaseDate && (
              <p className="text-[11px] text-dark-on-surface-variant">
                Data da compra: {formatDateBR(editingTransaction.purchaseDate)}
              </p>
            )}
          </div>
          {onRequestDeleteInstallmentGroup && editingTransaction.installmentGroupId && (
            <button
              type="button"
              onClick={() =>
                onRequestDeleteInstallmentGroup(
                  editingTransaction.installmentGroupId!,
                  editingTransaction.description.replace(/\s*\(\d+\/\d+\)\s*$/, '')
                )
              }
              className="px-3 py-1.5 rounded bg-error/15 border border-error/40 text-error text-[11px] font-semibold hover:bg-error/25 transition-colors"
            >
              Excluir todo o parcelamento
            </button>
          )}
        </section>
      )}

      {/* Despesa vs Receita Switch */}
      <div className="grid grid-cols-2 gap-2 p-1 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline">
        <button
          type="button"
          onClick={() => {
            setType('despesa');
            setConfirmDuplicate(false);
          }}
          className={`py-2 rounded text-xs font-bold transition-colors ${
            type === 'despesa'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'text-dark-on-surface-variant hover:text-dark-on-surface'
          }`}
        >
          Despesa
        </button>
        <button
          type="button"
          onClick={() => {
            setType('receita');
            if (mode === 'parcelada') setMode('unica');
            setConfirmDuplicate(false);
          }}
          className={`py-2 rounded text-xs font-bold transition-colors ${
            type === 'receita'
              ? 'bg-success text-dark-surface shadow-sm'
              : 'text-dark-on-surface-variant hover:text-dark-on-surface'
          }`}
        >
          Receita
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Amount Input Container */}
        <section className="p-6 rounded-lg bg-dark-surface-variant border border-dark-outline text-center relative">
          <label
            htmlFor="quickAmountInput"
            className="text-label-sm font-medium text-dark-on-surface-variant uppercase tracking-wider text-[11px] block"
          >
            Valor da Movimentação
          </label>

          <div className="flex items-baseline justify-center gap-1.5 my-3">
            <span
              className={`text-headline-lg font-bold ${
                type === 'receita' ? 'text-success' : 'text-primary'
              }`}
            >
              R$
            </span>
            <input
              id="quickAmountInput"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                setErrorMsg(null);
                setConfirmDuplicate(false);
              }}
              aria-label="Valor da movimentação"
              className="w-full max-w-[240px] bg-transparent text-center font-headline text-display-lg text-dark-on-surface font-extrabold tracking-tight tabular-nums focus:outline-none border-b border-dark-outline focus:border-primary pb-1"
              placeholder="0,00"
            />
          </div>

          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-label-sm max-w-full flex-wrap justify-center ${
              type === 'receita'
                ? 'bg-success/15 border-success/30 text-success'
                : 'bg-primary/15 border-primary/30 text-accent'
            }`}
          >
            <span className="material-symbols-outlined text-xs">
              {type === 'receita' ? 'trending_up' : 'trending_down'}
            </span>
            {!impactPreview.newInPeriod ? (
              <span>Fora do ciclo atual — não altera o teto deste ciclo</span>
            ) : type === 'receita' && status === 'pendente' ? (
              <span>
                Receita pendente — teto atual mantido em{' '}
                <strong className="tabular-nums font-bold whitespace-nowrap">
                  {centsToBRL(impactPreview.projectedAvailable)}
                </strong>
              </span>
            ) : (
              <span>
                {type === 'receita' ? 'Aumentará' : 'Reduzirá'} seu teto livre para{' '}
                <strong className="tabular-nums font-bold whitespace-nowrap">
                  {centsToBRL(impactPreview.projectedAvailable)}
                </strong>{' '}
                ({centsToBRL(impactPreview.projectedDaily)}/dia)
              </span>
            )}
          </div>
        </section>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-DEFAULT bg-error/10 border border-error/40 text-xs text-error flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base flex-shrink-0">error</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Description Note Field */}
        <div>
          <label
            htmlFor="quickDescInput"
            className="block text-label-sm font-semibold text-dark-on-surface mb-1.5"
          >
            Descrição / Estabelecimento
          </label>
          <div className="relative">
            <input
              id="quickDescInput"
              type="text"
              required
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setErrorMsg(null);
                setConfirmDuplicate(false);
              }}
              placeholder={
                type === 'receita'
                  ? 'Ex: Salário, Freela ou Bolsa'
                  : 'Ex: Almoço Restaurante ou Café Express'
              }
              className="w-full pl-4 pr-10 py-3 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-dark-on-surface text-body-md focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none placeholder-dark-on-surface-variant"
            />
            <span className="material-symbols-outlined absolute right-3 top-3 text-dark-on-surface-variant text-lg">
              edit
            </span>
          </div>
        </div>

        {/* Category Selection */}
        <div>
          <label className="block text-label-sm font-semibold text-dark-on-surface mb-2">
            {manualCategoryLock ? 'Categoria' : 'Categoria Sugerida'}
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {eligibleCategories.map((cat) => {
              const selected = categoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(cat.id);
                    setManualCategoryLock(true);
                  }}
                  className={`p-3 rounded-DEFAULT border flex flex-col items-center gap-1.5 transition-all ${
                    selected
                      ? 'bg-primary/20 border-primary text-dark-on-surface'
                      : 'bg-dark-surface-variant border-dark-outline text-dark-on-surface-variant hover:border-dark-on-surface-variant'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-xl ${
                      selected ? 'text-accent' : 'text-dark-on-surface-variant'
                    }`}
                  >
                    {cat.icon ?? 'category'}
                  </span>
                  <span className="text-[11px] font-semibold text-center leading-tight line-clamp-1">
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Budget Impact Type: Livre vs Fixo (apenas para despesa) */}
        {type === 'despesa' && (
          <div>
            <span className="block text-label-sm font-semibold text-dark-on-surface mb-2">
              Tipo de Despesa no Orçamento
            </span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setBudgetKind('livre')}
                className={`p-3.5 rounded-DEFAULT bg-dark-surface-variant text-left flex items-center justify-between transition-all ${
                  budgetKind === 'livre'
                    ? 'border-2 border-primary'
                    : 'border border-dark-outline opacity-65 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`material-symbols-outlined text-lg flex-shrink-0 ${
                      budgetKind === 'livre' ? 'text-accent' : 'text-dark-on-surface-variant'
                    }`}
                  >
                    wallet
                  </span>
                  <div className="min-w-0">
                    <p className="text-label-md font-bold text-dark-on-surface leading-tight">
                      Saldo Livre
                    </p>
                    <p className="text-[10px] text-dark-on-surface-variant">
                      Desconta do teto diário
                    </p>
                  </div>
                </div>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                    budgetKind === 'livre'
                      ? 'bg-primary text-white'
                      : 'border border-dark-outline'
                  }`}
                >
                  {budgetKind === 'livre' ? '✓' : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setBudgetKind('fixo')}
                className={`p-3.5 rounded-DEFAULT bg-dark-surface-variant text-left flex items-center justify-between transition-all ${
                  budgetKind === 'fixo'
                    ? 'border-2 border-primary'
                    : 'border border-dark-outline opacity-65 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`material-symbols-outlined text-lg flex-shrink-0 ${
                      budgetKind === 'fixo' ? 'text-warning' : 'text-dark-on-surface-variant'
                    }`}
                  >
                    lock
                  </span>
                  <div className="min-w-0">
                    <p className="text-label-md font-medium text-dark-on-surface leading-tight">
                      Gasto Fixo
                    </p>
                    <p className="text-[10px] text-dark-on-surface-variant">Conta planejada</p>
                  </div>
                </div>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                    budgetKind === 'fixo'
                      ? 'bg-primary text-white'
                      : 'border border-dark-outline'
                  }`}
                >
                  {budgetKind === 'fixo' ? '✓' : ''}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Modalidade (Única, Parcelada, Recorrente) */}
        {!isEditing && (
          <div>
            <span className="block text-label-sm font-semibold text-dark-on-surface mb-2">
              Frequência / Forma de Lançamento
            </span>
            <div className={`grid gap-2 ${type === 'despesa' ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {(
                [
                  { id: 'unica', label: 'Única' },
                  ...(type === 'despesa' ? [{ id: 'parcelada', label: 'Parcelada' }] : []),
                  { id: 'recorrente', label: 'Recorrente' },
                ] as Array<{ id: EntryMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMode(m.id);
                    setErrorMsg(null);
                  }}
                  className={`py-2 px-3 rounded-DEFAULT border text-xs font-semibold transition-colors ${
                    mode === m.id
                      ? 'bg-primary/20 border-primary text-dark-on-surface'
                      : 'bg-dark-surface-variant border-dark-outline text-dark-on-surface-variant hover:text-dark-on-surface'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Campos específicos de Parcelamento */}
        {mode === 'parcelada' && !isEditing && (
          <div className="p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="installmentsInput"
                className="block text-[11px] font-medium text-dark-on-surface-variant mb-1"
              >
                Parcelas (2 a {MAX_INSTALLMENTS})
              </label>
              <input
                id="installmentsInput"
                type="number"
                min={2}
                max={MAX_INSTALLMENTS}
                value={installmentsCount}
                onChange={(e) => {
                  setInstallmentsCount(e.target.value);
                  setErrorMsg(null);
                }}
                className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="purchaseDateInput"
                className="block text-[11px] font-medium text-dark-on-surface-variant mb-1"
              >
                Data da compra
              </label>
              <input
                id="purchaseDateInput"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Campos específicos de Recorrência */}
        {mode === 'recorrente' && !isEditing && (
          <div className="p-3.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="recurrenceFreq"
                className="block text-[11px] font-medium text-dark-on-surface-variant mb-1"
              >
                Periodicidade
              </label>
              <select
                id="recurrenceFreq"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
              >
                <option value="semanal">Semanal</option>
                <option value="quinzenal">Quinzenal</option>
                <option value="mensal">Mensal</option>
                <option value="anual">Anual</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="recurrenceEndDate"
                className="block text-[11px] font-medium text-dark-on-surface-variant mb-1"
              >
                Fim opcional
              </label>
              <input
                id="recurrenceEndDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Data efetiva e Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="txDateInput"
              className="block text-[11px] font-semibold text-dark-on-surface mb-1"
            >
              {mode === 'parcelada' ? '1º Vencimento' : 'Data'}
            </label>
            <input
              id="txDateInput"
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setErrorMsg(null);
              }}
              className="w-full px-3 py-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-xs text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-[11px] font-semibold text-dark-on-surface mb-1">
              Situação
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setStatus('pago')}
                className={`py-2.5 rounded-DEFAULT border text-xs font-semibold transition-colors ${
                  status === 'pago'
                    ? 'bg-success/20 border-success text-success'
                    : 'bg-dark-surface-variant border-dark-outline text-dark-on-surface-variant'
                }`}
              >
                {type === 'receita' ? 'Recebido' : 'Pago'}
              </button>
              <button
                type="button"
                onClick={() => setStatus('pendente')}
                className={`py-2.5 rounded-DEFAULT border text-xs font-semibold transition-colors ${
                  status === 'pendente'
                    ? 'bg-warning/20 border-warning text-warning'
                    : 'bg-dark-surface-variant border-dark-outline text-dark-on-surface-variant'
                }`}
              >
                Pendente
              </button>
            </div>
          </div>
        </div>

        {isEditing && isEditingInstallment && (
          <label className="flex items-center gap-2 p-3 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-xs text-dark-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={applyToPendingGroup}
              onChange={(e) => setApplyToPendingGroup(e.target.checked)}
              className="rounded border-dark-outline bg-dark-surface text-primary focus:ring-primary"
            />
            <span>Aplicar categoria e descrição nas demais parcelas pendentes deste parcelamento</span>
          </label>
        )}

        {/* Alerta de Dia Não Útil (Fim de Semana / Feriado Nacional BR) */}
        {nonBusinessReason && (
          <div
            role="status"
            className="p-3 rounded-DEFAULT bg-warning/10 border border-warning/40 space-y-2"
          >
            <div className="flex items-start gap-2 text-xs text-warning">
              <span className="material-symbols-outlined text-base flex-shrink-0 mt-0.5">
                event_busy
              </span>
              <p className="leading-snug">
                Atenção: <strong>{formatDateBR(date)}</strong> cai em{' '}
                <strong>{nonBusinessReason}</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDate(nextBusinessDay)}
              className="w-full py-2 px-3 rounded bg-warning/20 hover:bg-warning/30 text-warning text-[11px] font-bold transition-colors"
            >
              Ajustar para próximo dia útil ({formatDateBR(nextBusinessDay)})
            </button>
          </div>
        )}

        {/* Alerta de Possível Duplicidade */}
        {confirmDuplicate && (
          <div
            role="alert"
            className="p-3 rounded-DEFAULT bg-warning/10 border border-warning/40 space-y-1.5 text-xs text-warning"
          >
            <p className="font-bold">Movimentação semelhante detectada na mesma data</p>
            <p className="text-[11px] text-dark-on-surface-variant">
              Já existe um lançamento com mesma descrição, valor e data. Clique em confirmar novamente para salvar mesmo assim.
            </p>
          </div>
        )}

        {/* Preventive Reflection Callout */}
        <div className="p-3.5 rounded-DEFAULT bg-dark-surface-variant/70 border border-dark-outline flex items-start gap-2.5">
          <span className="material-symbols-outlined text-warning text-lg flex-shrink-0 mt-0.5">
            psychology
          </span>
          <p className="text-[11px] text-dark-on-surface-variant leading-relaxed">
            <strong className="text-dark-on-surface font-semibold">Reflexão Consciente:</strong>{' '}
            Registrar imediatamente antes ou após a compra reduz a invisibilidade dos microgastos do Pix e aproximação.
          </p>
        </div>

        {/* Submit & Optional Delete Actions */}
        <div className="pt-2 space-y-2.5">
          <button
            type="submit"
            className="w-full py-3.5 px-4 rounded-DEFAULT bg-primary text-on-primary font-headline text-label-lg font-bold shadow-lg shadow-primary/25 hover:bg-accent flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-xl">check_circle</span>
            <span>
              {confirmDuplicate
                ? 'Confirmar Mesmo Assim'
                : isEditing
                ? 'Salvar Alterações no Teto'
                : 'Confirmar e Atualizar Teto'}
            </span>
          </button>

          {isEditing && editingTransaction && onRequestDelete && (
            <button
              type="button"
              onClick={() => onRequestDelete(editingTransaction)}
              className="w-full py-2.5 px-4 rounded-DEFAULT bg-dark-surface-variant border border-error/40 text-error text-xs font-semibold hover:bg-error/10 transition-colors"
            >
              Excluir Movimentação
            </button>
          )}
        </div>
        </form>
      </div>

      {/* Modal: Scanner de Comprovante (Simulador Demo) */}
      {scannerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scanner-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setScannerOpen(false);
          }}
        >
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-primary/50 rounded-xl p-5 space-y-4 shadow-2xl text-center">
            <div className="flex items-center justify-between border-b border-dark-outline pb-2">
              <span id="scanner-title" className="font-headline text-headline-sm text-dark-on-surface font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-xl">
                  document_scanner
                </span>
                Leitor de Nota (Simulador Demo)
              </span>
              <button
                type="button"
                onClick={() => setScannerOpen(false)}
                aria-label="Fechar leitor de nota"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="p-5 rounded-lg bg-dark-surface border-2 border-dashed border-primary/40 space-y-2.5">
              <div className="w-12 h-12 rounded-full bg-primary/20 text-accent mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">photo_camera</span>
              </div>
              <p className="text-xs font-semibold text-dark-on-surface">
                Simulação de OCR para Cupom ou Comprovante Pix
              </p>
              <p className="text-[11px] text-dark-on-surface-variant">
                Recurso demonstrativo sem leitura real de câmera: escolha um exemplo para preencher os campos editáveis.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  applySampleReceipt({
                    desc: 'Padaria Central',
                    amount: '18,50',
                    cat: 'cat-alimentacao',
                    kind: 'livre',
                  })
                }
                className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Simular Leitura Instantânea (Padaria Central • R$ 18,50)
              </button>
              <button
                type="button"
                onClick={() =>
                  applySampleReceipt({
                    desc: 'Corrida Uber Centro',
                    amount: '24,90',
                    cat: 'cat-transporte',
                    kind: 'livre',
                  })
                }
                className="w-full py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold hover:border-primary/50"
              >
                Simular Comprovante Uber (R$ 24,90)
              </button>
            </div>
          </div>
        </div>
      )}
    </StitchShell>
  );
}
