import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  centsToBRL,
  centsToInputString,
  parseCurrencyInputToCents,
} from '../domain/formatters';
import type { TransactionType, WorkspaceState } from '../domain/types';
import {
  validateAndParseBackupJson,
  type BackupValidationResult,
} from '../storage/repository';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

type BudgetField =
  | 'monthlyNetIncomeCents'
  | 'monthlyFixedExpensesCents'
  | 'monthlyReserveGoalCents';

interface ProfileViewProps {
  state: WorkspaceState;
  onNavigate: (view: AppView) => void;
  onUpdateProfileInfo: (payload: {
    name: string;
    roleLabel: string;
    emergencyReserveTargetCents: number;
  }) => void;
  onUpdateBudgetField: (field: BudgetField, valueCents: number) => void;
  onTogglePreference: (pref: 'proactiveAlerts' | 'biometricLock', value: boolean) => void;
  onAddCategory: (payload: {
    name: string;
    type: TransactionType | 'ambos';
    color: string;
    icon: string;
  }) => void;
  onRemoveCategory: (categoryId: string) => void;
  onExportBackup: () => void;
  onRestoreBackup: (workspace: WorkspaceState) => void;
  onRequestResetDemo: () => void;
  onRequestResetEmpty: () => void;
  onRequestLogout: () => void;
  toasts: ToastNotice[];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TF';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfileView({
  state,
  onNavigate,
  onUpdateProfileInfo,
  onUpdateBudgetField,
  onTogglePreference,
  onAddCategory,
  onRemoveCategory,
  onExportBackup,
  onRestoreBackup,
  onRequestResetDemo,
  onRequestResetEmpty,
  onRequestLogout,
  toasts,
}: ProfileViewProps) {
  const { profile } = state;
  const backupFileRef = useRef<HTMLInputElement>(null);

  const [activeSheet, setActiveSheet] = useState<{
    field: BudgetField;
    title: string;
    desc: string;
  } | null>(null);
  const [sheetInput, setSheetInput] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [roleDraft, setRoleDraft] = useState(profile.roleLabel);
  const [reserveTargetDraft, setReserveTargetDraft] = useState(
    centsToInputString(profile.emergencyReserveTargetCents)
  );
  const [profileError, setProfileError] = useState<string | null>(null);

  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<TransactionType>('despesa');
  const [newCatColor, setNewCatColor] = useState('#E53935');
  const [catError, setCatError] = useState<string | null>(null);

  const [pendingBackup, setPendingBackup] = useState<BackupValidationResult | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const handleBackupFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    setBackupError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const validated = validateAndParseBackupJson(text, state.profile);
      if (!validated.ok) {
        setBackupError(validated.error);
        return;
      }
      setPendingBackup(validated);
    } catch {
      setBackupError('Não foi possível ler o arquivo selecionado.');
    }
  };

  const openBudgetSheet = (field: BudgetField, title: string, desc: string) => {
    setActiveSheet({ field, title, desc });
    setSheetInput(centsToInputString(profile[field]));
    setSheetError(null);
  };

  const handleSaveSheet = (e: FormEvent) => {
    e.preventDefault();
    if (!activeSheet) return;
    const parsed = parseCurrencyInputToCents(sheetInput, false);
    if (parsed === null || parsed < 0) {
      setSheetError('Informe um valor válido maior ou igual a R$ 0,00.');
      return;
    }
    onUpdateBudgetField(activeSheet.field, parsed);
    setActiveSheet(null);
  };

  const handleSaveProfile = (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    const trimmedName = nameDraft.trim();
    const trimmedRole = roleDraft.trim() || 'Orçamento Pessoal';
    const parsedTarget = parseCurrencyInputToCents(reserveTargetDraft, true);

    if (trimmedName.length < 2) {
      setProfileError('Informe seu nome completo.');
      return;
    }
    if (!parsedTarget || parsedTarget <= 0) {
      setProfileError('Informe uma meta de reserva maior que R$ 0,00.');
      return;
    }

    onUpdateProfileInfo({
      name: trimmedName,
      roleLabel: trimmedRole,
      emergencyReserveTargetCents: parsedTarget,
    });
    setEditProfileOpen(false);
  };

  const handleAddCategorySubmit = (e: FormEvent) => {
    e.preventDefault();
    setCatError(null);
    const trimmed = newCatName.trim();
    if (trimmed.length < 2) {
      setCatError('Informe o nome da nova categoria.');
      return;
    }
    if (state.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setCatError('Já existe uma categoria com esse nome.');
      return;
    }
    onAddCategory({
      name: trimmed,
      type: newCatType,
      color: newCatColor,
      icon: newCatType === 'receita' ? 'payments' : 'label',
    });
    setNewCatName('');
  };

  const isPremium = profile.plan === 'premium';

  return (
    <StitchShell
      activeView="profile"
      onNavigate={onNavigate}
      showBack
      backTo="dashboard"
      title="Meu Perfil"
      subtitle="Configurações de conta e limites"
      toasts={toasts}
    >
      {/* Interactive User Card */}
      <section className="animate-fade-in-up delay-1 p-4 rounded-lg bg-dark-surface-variant border border-dark-outline flex items-center justify-between transition-all duration-200 hover:border-primary/40 group">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-13 h-13 rounded-full bg-gradient-to-tr from-primary to-accent p-0.5 transition-transform duration-300 group-hover:scale-105">
              <div className="w-12 h-12 rounded-full bg-dark-surface flex items-center justify-center text-dark-on-surface font-bold text-lg">
                {getInitials(profile.name)}
              </div>
            </div>
            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-success ring-2 ring-dark-surface" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-headline text-headline-sm text-dark-on-surface font-bold leading-tight truncate">
                {profile.name}
              </h2>
              <span className="px-1.5 py-0.2 rounded bg-success/20 text-success text-[10px] font-semibold border border-success/30 whitespace-nowrap">
                Nível {profile.level}
              </span>
            </div>
            <p className="text-body-sm text-dark-on-surface-variant text-xs mt-0.5 truncate">
              {profile.roleLabel} • {centsToBRL(profile.monthlyNetIncomeCents)}/mês
            </p>
            <p className="text-[11px] text-dark-on-surface-variant/80 truncate">{profile.email}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setNameDraft(profile.name);
            setRoleDraft(profile.roleLabel);
            setReserveTargetDraft(centsToInputString(profile.emergencyReserveTargetCents));
            setProfileError(null);
            setEditProfileOpen(true);
          }}
          aria-label="Editar dados do perfil"
          className="w-8 h-8 rounded-full bg-dark-surface border border-dark-outline flex items-center justify-center text-dark-on-surface-variant hover:text-dark-on-surface hover:border-primary/50 transition-all duration-150 active:scale-90 flex-shrink-0"
        >
          <span className="material-symbols-outlined text-base">edit</span>
        </button>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        <div className="md:col-span-6 space-y-5 min-w-0">
      {/* Subscription Status Banner */}
      <section className="animate-fade-in-up delay-2 p-4 rounded-DEFAULT bg-gradient-to-r from-dark-surface-variant via-dark-surface-variant to-[#20161A] border border-primary/40 flex items-center justify-between gap-2 transition-all duration-200 hover:border-primary/70">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-label-md font-bold text-dark-on-surface">
              {isPremium ? 'Plano Premium' : 'Plano Gratuito'}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-dark-surface text-[10px] text-dark-on-surface-variant border border-dark-outline">
              Ativo
            </span>
          </div>
          <p className="text-body-sm text-dark-on-surface-variant text-[11px] truncate">
            {isPremium
              ? 'Radar de microgastos e recursos avançados ativos'
              : 'Registro essencial e cálculo automático de teto'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('plans')}
          className="animate-pulse-glow px-3 py-1.5 rounded-sm bg-primary text-on-primary font-headline text-label-sm font-semibold hover:bg-accent transition-all duration-150 active:scale-95 shadow-sm shadow-primary/30 flex-shrink-0 text-center"
        >
          {isPremium ? 'Gerenciar Plano' : 'Assinar Premium'}
        </button>
      </section>

      {/* Configuração do Orçamento Reverso */}
      <section className="animate-fade-in-up delay-3 space-y-2">
        <h3 className="text-label-md font-semibold text-dark-on-surface px-1">
          Configuração do Orçamento Reverso
        </h3>

        <div className="rounded-DEFAULT bg-dark-surface-variant border border-dark-outline divide-y divide-dark-outline/60 overflow-hidden">
          <button
            type="button"
            onClick={() =>
              openBudgetSheet(
                'monthlyNetIncomeCents',
                'Renda Líquida Mensal',
                'Salário, bolsa ou renda líquida principal do ciclo atual'
              )
            }
            className="w-full p-3.5 flex items-center justify-between hover:bg-dark-surface/50 active:bg-dark-surface transition-colors text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-lg">payments</span>
              </div>
              <div>
                <p className="text-label-md font-medium text-dark-on-surface text-xs group-hover:text-primary transition-colors">
                  Renda Líquida Mensal
                </p>
                <p className="text-[11px] text-dark-on-surface-variant tabular-nums">
                  {centsToBRL(profile.monthlyNetIncomeCents)} cadastrados
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-dark-on-surface-variant text-base group-hover:translate-x-1 transition-transform">
              chevron_right
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              openBudgetSheet(
                'monthlyFixedExpensesCents',
                'Gastos Fixos Mensais',
                'Aluguel, internet, assinaturas e contas fixas do ciclo'
              )
            }
            className="w-full p-3.5 flex items-center justify-between hover:bg-dark-surface/50 active:bg-dark-surface transition-colors text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center text-warning group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-lg">lock</span>
              </div>
              <div>
                <p className="text-label-md font-medium text-dark-on-surface text-xs group-hover:text-warning transition-colors">
                  Gastos Fixos Mensais
                </p>
                <p className="text-[11px] text-dark-on-surface-variant tabular-nums">
                  {centsToBRL(profile.monthlyFixedExpensesCents)} (Aluguel, contas & internet)
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-dark-on-surface-variant text-base group-hover:translate-x-1 transition-transform">
              chevron_right
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              openBudgetSheet(
                'monthlyReserveGoalCents',
                'Meta de Reserva Mensal',
                'Valor separado automaticamente do teto para sua reserva'
              )
            }
            className="w-full p-3.5 flex items-center justify-between hover:bg-dark-surface/50 active:bg-dark-surface transition-colors text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-lg">savings</span>
              </div>
              <div>
                <p className="text-label-md font-medium text-dark-on-surface text-xs group-hover:text-success transition-colors">
                  Meta de Reserva Mensal
                </p>
                <p className="text-[11px] text-dark-on-surface-variant tabular-nums">
                  {centsToBRL(profile.monthlyReserveGoalCents)} poupados por ciclo
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-dark-on-surface-variant text-base group-hover:translate-x-1 transition-transform">
              chevron_right
            </span>
          </button>
        </div>
      </section>
        </div>

        <div className="md:col-span-6 space-y-5 min-w-0">
      {/* Segurança e Preferências */}
      <section className="animate-fade-in-up delay-4 space-y-2">
        <h3 className="text-label-md font-semibold text-dark-on-surface px-1">
          Segurança e Preferências
        </h3>

        <div className="rounded-DEFAULT bg-dark-surface-variant border border-dark-outline divide-y divide-dark-outline/60 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setCatError(null);
              setCatManagerOpen(true);
            }}
            className="w-full p-3.5 flex items-center justify-between hover:bg-dark-surface/50 active:bg-dark-surface transition-colors text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-lg">category</span>
              </div>
              <div>
                <p className="text-label-md font-medium text-dark-on-surface text-xs group-hover:text-primary transition-colors">
                  Categorias de Gastos
                </p>
                <p className="text-[11px] text-dark-on-surface-variant">
                  {state.categories.length} categorias ativas na divisão do teto
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-dark-on-surface-variant text-base group-hover:translate-x-1 transition-transform">
              chevron_right
            </span>
          </button>

          <div className="p-3.5 flex items-center justify-between hover:bg-dark-surface/30 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                <span className="material-symbols-outlined text-lg">notifications_active</span>
              </div>
              <div>
                <p className="text-label-md font-medium text-dark-on-surface text-xs">
                  Alertas Proativos de Teto
                </p>
                <p className="text-[11px] text-dark-on-surface-variant">
                  Avisar ao atingir 80% do limite
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                aria-label="Alertas Proativos de Teto"
                checked={profile.proactiveAlerts}
                onChange={(e) => onTogglePreference('proactiveAlerts', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-dark-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:duration-200 peer-checked:bg-primary transition-colors duration-200" />
            </label>
          </div>

          <div className="p-3.5 flex items-center justify-between hover:bg-dark-surface/30 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-dark-surface flex items-center justify-center text-dark-on-surface-variant">
                <span className="material-symbols-outlined text-lg">fingerprint</span>
              </div>
              <div>
                <p className="text-label-md font-medium text-dark-on-surface text-xs">
                  Biometria / Face ID
                </p>
                <p className="text-[11px] text-dark-on-surface-variant">
                  Preferência de proteção de acesso
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                aria-label="Biometria e Face ID"
                checked={profile.biometricLock}
                onChange={(e) => onTogglePreference('biometricLock', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-dark-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:duration-200 peer-checked:bg-primary transition-colors duration-200" />
            </label>
          </div>
        </div>
      </section>

      {/* Gerenciamento de Dados Locais */}
      <section className="animate-fade-in-up delay-5 space-y-2.5">
        <h3 className="text-label-md font-semibold text-dark-on-surface px-1">
          Gerenciamento de Dados Locais
        </h3>

        {backupError && (
          <div
            role="alert"
            className="p-2.5 rounded-DEFAULT bg-error/10 border border-error/40 text-[11px] text-error flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base flex-shrink-0">error</span>
            <span>{backupError}</span>
          </div>
        )}

        <input
          ref={backupFileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Selecionar arquivo JSON de backup"
          onChange={handleBackupFileSelected}
          className="hidden"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={onExportBackup}
            className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] font-semibold text-dark-on-surface hover:border-primary/50 flex flex-col items-center gap-1 text-center"
          >
            <span className="material-symbols-outlined text-base text-success">download</span>
            <span>Backup JSON</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setBackupError(null);
              backupFileRef.current?.click();
            }}
            className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] font-semibold text-dark-on-surface hover:border-primary/50 flex flex-col items-center gap-1 text-center"
          >
            <span className="material-symbols-outlined text-base text-accent">upload_file</span>
            <span>Restaurar JSON</span>
          </button>
          <button
            type="button"
            onClick={onRequestResetDemo}
            className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] font-semibold text-dark-on-surface hover:border-primary/50 flex flex-col items-center gap-1 text-center"
          >
            <span className="material-symbols-outlined text-base text-warning">restart_alt</span>
            <span>Restaurar Demo</span>
          </button>
          <button
            type="button"
            onClick={onRequestResetEmpty}
            className="p-2.5 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-[11px] font-semibold text-dark-on-surface hover:border-error/50 flex flex-col items-center gap-1 text-center"
          >
            <span className="material-symbols-outlined text-base text-error">delete_sweep</span>
            <span>Zerar Dados</span>
          </button>
        </div>
      </section>

      {/* Logout Action */}
      <div className="animate-fade-in-up delay-5 pt-1">
        <button
          type="button"
          onClick={onRequestLogout}
          className="w-full py-3 px-4 rounded-DEFAULT bg-dark-surface-variant border border-error/30 text-error hover:bg-error/15 active:scale-95 font-headline text-label-md font-semibold flex items-center justify-center gap-2 transition-all duration-150"
        >
          <span className="material-symbols-outlined text-lg">logout</span>
          <span>Sair da Conta</span>
        </button>
      </div>
        </div>
      </div>

      {/* Bottom Sheet: Edição Rápida de Orçamento */}
      {activeSheet && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center md:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="budget-sheet-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveSheet(null);
          }}
        >
          <form
            onSubmit={handleSaveSheet}
            className="w-full max-w-[420px] max-h-[90vh] overflow-y-auto bg-dark-surface-variant border-t md:border border-dark-outline rounded-t-xl md:rounded-xl p-5 space-y-4 shadow-2xl"
          >
            <div className="w-10 h-1 bg-dark-outline rounded-full mx-auto mb-2" />

            <div className="flex items-center justify-between">
              <h4
                id="budget-sheet-title"
                className="font-headline text-headline-sm text-dark-on-surface font-bold"
              >
                {activeSheet.title}
              </h4>
              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                aria-label="Fechar edição do orçamento"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {sheetError && (
              <div role="alert" className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                {sheetError}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="budgetSheetInput" className="text-[11px] text-dark-on-surface-variant">
                Valor Definido no Orçamento (R$)
              </label>
              <input
                id="budgetSheetInput"
                type="text"
                inputMode="decimal"
                value={sheetInput}
                onChange={(e) => {
                  setSheetInput(e.target.value);
                  setSheetError(null);
                }}
                className="w-full px-4 py-3 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface font-bold text-lg focus:border-primary focus:outline-none tabular-nums"
              />
              <p className="text-[11px] text-dark-on-surface-variant">{activeSheet.desc}</p>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                className="flex-1 py-3 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface text-xs font-semibold hover:border-dark-on-surface-variant transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-3 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold shadow-md shadow-primary/20 hover:bg-accent transition-colors"
              >
                Salvar Alteração
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Editar Dados do Perfil */}
      {editProfileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-profile-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditProfileOpen(false);
          }}
        >
          <form
            onSubmit={handleSaveProfile}
            className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3
                id="edit-profile-modal-title"
                className="font-headline text-headline-sm text-dark-on-surface font-bold"
              >
                Editar Perfil
              </h3>
              <button
                type="button"
                onClick={() => setEditProfileOpen(false)}
                aria-label="Fechar edição de perfil"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {profileError && (
              <div role="alert" className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                {profileError}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <label htmlFor="profileNameInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                  Nome Completo
                </label>
                <input
                  id="profileNameInput"
                  type="text"
                  required
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="profileRoleInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                  Perfil / Ocupação
                </label>
                <input
                  id="profileRoleInput"
                  type="text"
                  value={roleDraft}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="profileReserveTargetInput" className="text-[11px] text-dark-on-surface-variant block mb-1">
                  Meta da Reserva de Emergência (R$)
                </label>
                <input
                  id="profileReserveTargetInput"
                  type="text"
                  inputMode="decimal"
                  required
                  value={reserveTargetDraft}
                  onChange={(e) => setReserveTargetDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface tabular-nums focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditProfileOpen(false)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Salvar Perfil
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Gerenciar Categorias */}
      {catManagerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cat-manager-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCatManagerOpen(false);
          }}
        >
          <div className="w-full max-w-sm bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl max-h-[85vh] flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-dark-outline pb-2">
              <h3 id="cat-manager-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                Categorias de Gastos
              </h3>
              <button
                type="button"
                onClick={() => setCatManagerOpen(false)}
                aria-label="Fechar gerenciador de categorias"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <form onSubmit={handleAddCategorySubmit} className="space-y-2 border-b border-dark-outline pb-3">
              {catError && (
                <div role="alert" className="p-2 rounded bg-error/10 border border-error/40 text-[11px] text-error">
                  {catError}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  aria-label="Nome da nova categoria"
                  placeholder="Nova categoria"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="col-span-2 px-3 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                />
                <select
                  aria-label="Tipo da nova categoria"
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value as TransactionType)}
                  className="px-2 py-2 rounded bg-dark-surface border border-dark-outline text-xs text-dark-on-surface focus:border-primary focus:outline-none"
                >
                  <option value="despesa">Despesa</option>
                  <option value="receita">Receita</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {['#E53935', '#F59E0B', '#10B981', '#6366F1', '#EC4899'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewCatColor(col)}
                      aria-label={`Selecionar cor ${col}`}
                      className={`w-5 h-5 rounded-full border-2 ${
                        newCatColor === col ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-bold hover:bg-accent"
                >
                  + Adicionar
                </button>
              </div>
            </form>

            <div className="space-y-1.5 overflow-y-auto max-h-[42vh]">
              {state.categories.map((cat) => {
                const inUse =
                  state.transactions.some((t) => t.categoryId === cat.id) ||
                  state.recurringRules.some((r) => r.categoryId === cat.id);
                return (
                  <div
                    key={cat.id}
                    className="p-2 rounded bg-dark-surface border border-dark-outline flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-dark-on-surface font-medium truncate">{cat.name}</span>
                      <span className="text-[10px] text-dark-on-surface-variant">
                        ({cat.type})
                      </span>
                    </div>
                    {!cat.isDefault && !inUse ? (
                      <button
                        type="button"
                        onClick={() => onRemoveCategory(cat.id)}
                        aria-label={`Remover categoria "${cat.name}"`}
                        className="text-dark-on-surface-variant hover:text-error"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    ) : (
                      <span className="text-[10px] text-dark-on-surface-variant">
                        {cat.isDefault ? 'Padrão' : 'Em uso'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Restauração de Backup */}
      {pendingBackup && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-backup-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingBackup(null);
          }}
        >
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-primary/50 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-accent text-xl">upload_file</span>
                <h3
                  id="restore-backup-title"
                  className="font-headline text-headline-sm text-dark-on-surface font-bold"
                >
                  Restaurar Backup JSON
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingBackup(null)}
                aria-label="Fechar restauração de backup"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <p className="text-xs text-dark-on-surface-variant leading-relaxed">
              O arquivo foi validado com sucesso. Ao confirmar, os dados atuais desta conta ({state.profile.email}) serão substituídos por:
            </p>

            <div className="p-3 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs space-y-1.5 tabular-nums">
              <div className="flex justify-between">
                <span className="text-dark-on-surface-variant">Movimentações:</span>
                <strong className="text-dark-on-surface">{pendingBackup.summary.transactionsCount}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-on-surface-variant">Recorrências:</span>
                <strong className="text-dark-on-surface">{pendingBackup.summary.recurringRulesCount}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-on-surface-variant">Reserva:</span>
                <strong className="text-dark-on-surface">{pendingBackup.summary.reserveMovementsCount}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-on-surface-variant">Metas:</span>
                <strong className="text-dark-on-surface">{pendingBackup.summary.goalsCount}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-on-surface-variant">Categorias:</span>
                <strong className="text-dark-on-surface">{pendingBackup.summary.categoriesCount}</strong>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingBackup(null)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const ws = pendingBackup.workspace;
                  setPendingBackup(null);
                  onRestoreBackup(ws);
                }}
                className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Confirmar Restauração
              </button>
            </div>
          </div>
        </div>
      )}
    </StitchShell>
  );
}
