import {
  createDemoWorkspaceForAccount,
  createEmptyWorkspace,
  DEFAULT_CATEGORIES,
  DEMO_ACCOUNTS,
} from '../data/seedData';
import { isValidISODate } from '../domain/formatters';
import type {
  AppSession,
  BudgetProfile,
  Category,
  Goal,
  LocalAccount,
  RecurringRule,
  ReserveMovement,
  Transaction,
  WorkspaceState,
} from '../domain/types';

const ACCOUNTS_KEY = 'teto_local_accounts_v2';
const SESSION_KEY = 'teto_active_session_v2';
const WORKSPACE_PREFIX = 'teto_workspace_v2_';

export interface StorageWriteResult {
  ok: boolean;
  error?: string;
}

export interface StorageLoadResult {
  ok: boolean;
  workspace: WorkspaceState;
  error?: string;
}

export interface BackupValidationResult {
  ok: true;
  workspace: WorkspaceState;
  summary: {
    transactionsCount: number;
    recurringRulesCount: number;
    reserveMovementsCount: number;
    goalsCount: number;
    categoriesCount: number;
  };
}

export interface BackupValidationError {
  ok: false;
  error: string;
}

/**
 * SHA-256 em TypeScript puro para uso em ambientes sem crypto.subtle (ex: HTTP não-localhost)
 * e migração síncrona de contas legadas. Primariamente usamos crypto.subtle quando disponível.
 */
function sha256HexSync(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

function generateSalt(): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint8Array(12);
    globalThis.crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `salt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function hashPasswordWithSalt(password: string, salt: string): Promise<string> {
  const payload = `${salt}:${password}`;
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const encoded = new TextEncoder().encode(payload);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256HexSync(payload);
}

function isValidTransaction(raw: unknown): raw is Transaction {
  if (!raw || typeof raw !== 'object') return false;
  const tx = raw as Partial<Transaction>;
  if (typeof tx.id !== 'string' || !tx.id.trim()) return false;
  if (tx.type !== 'receita' && tx.type !== 'despesa') return false;
  if (typeof tx.description !== 'string' || !tx.description.trim()) return false;
  if (typeof tx.amountCents !== 'number' || !Number.isInteger(tx.amountCents) || tx.amountCents <= 0) {
    return false;
  }
  if (typeof tx.date !== 'string' || !isValidISODate(tx.date)) return false;
  if (typeof tx.categoryId !== 'string' || !tx.categoryId.trim()) return false;
  if (tx.status !== 'pago' && tx.status !== 'pendente' && tx.status !== 'cancelado') return false;
  if (tx.budgetKind !== undefined && tx.budgetKind !== 'livre' && tx.budgetKind !== 'fixo') {
    return false;
  }
  return true;
}

function isValidCategory(raw: unknown): raw is Category {
  if (!raw || typeof raw !== 'object') return false;
  const cat = raw as Partial<Category>;
  if (typeof cat.id !== 'string' || !cat.id.trim()) return false;
  if (typeof cat.name !== 'string' || !cat.name.trim()) return false;
  if (cat.type !== 'receita' && cat.type !== 'despesa' && cat.type !== 'ambos') return false;
  if (typeof cat.color !== 'string' || !cat.color.trim()) return false;
  return true;
}

function isValidRecurringRule(raw: unknown): raw is RecurringRule {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Partial<RecurringRule>;
  if (typeof r.id !== 'string' || !r.id.trim()) return false;
  if (r.type !== 'receita' && r.type !== 'despesa') return false;
  if (typeof r.description !== 'string' || !r.description.trim()) return false;
  if (typeof r.amountCents !== 'number' || !Number.isInteger(r.amountCents) || r.amountCents <= 0) {
    return false;
  }
  if (typeof r.categoryId !== 'string' || !r.categoryId.trim()) return false;
  if (
    r.frequency !== 'semanal' &&
    r.frequency !== 'quinzenal' &&
    r.frequency !== 'mensal' &&
    r.frequency !== 'anual'
  ) {
    return false;
  }
  if (typeof r.startDate !== 'string' || !isValidISODate(r.startDate)) return false;
  if (r.endDate !== undefined && (typeof r.endDate !== 'string' || !isValidISODate(r.endDate))) {
    return false;
  }
  if (r.defaultStatus !== 'pago' && r.defaultStatus !== 'pendente') return false;
  if (typeof r.active !== 'boolean') return false;
  return true;
}

function isValidReserveMovement(raw: unknown): raw is ReserveMovement {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<ReserveMovement>;
  if (typeof m.id !== 'string' || !m.id.trim()) return false;
  if (m.type !== 'aporte' && m.type !== 'resgate') return false;
  if (typeof m.amountCents !== 'number' || !Number.isInteger(m.amountCents) || m.amountCents <= 0) {
    return false;
  }
  if (typeof m.date !== 'string' || !isValidISODate(m.date)) return false;
  if (typeof m.description !== 'string') return false;
  return true;
}

function isValidGoal(raw: unknown): raw is Goal {
  if (!raw || typeof raw !== 'object') return false;
  const g = raw as Partial<Goal>;
  if (typeof g.id !== 'string' || !g.id.trim()) return false;
  if (typeof g.title !== 'string' || !g.title.trim()) return false;
  if (typeof g.targetCents !== 'number' || !Number.isInteger(g.targetCents) || g.targetCents <= 0) {
    return false;
  }
  if (typeof g.savedCents !== 'number' || !Number.isInteger(g.savedCents) || g.savedCents < 0) {
    return false;
  }
  return true;
}

function getFallbackWorkspace(account?: LocalAccount): WorkspaceState {
  if (account?.isDemo) {
    return createDemoWorkspaceForAccount(account.id);
  }
  return createEmptyWorkspace(
    account
      ? {
          name: account.name,
          email: account.email,
          roleLabel: account.roleLabel,
        }
      : undefined
  );
}

function sanitizeState(raw: unknown, account?: LocalAccount): WorkspaceState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<WorkspaceState>;
  if (!Array.isArray(candidate.transactions) || !Array.isArray(candidate.categories)) {
    return null;
  }

  const fallback = getFallbackWorkspace(account);
  const validCategories = candidate.categories.filter(isValidCategory);
  const validTransactions = candidate.transactions.filter(isValidTransaction);
  const validRules = Array.isArray(candidate.recurringRules)
    ? candidate.recurringRules.filter(isValidRecurringRule)
    : [];
  const validReserve = Array.isArray(candidate.reserveMovements)
    ? candidate.reserveMovements.filter(isValidReserveMovement)
    : [];
  const validGoals = Array.isArray(candidate.goals) ? candidate.goals.filter(isValidGoal) : [];
  const validSkipped = Array.isArray(candidate.skippedOccurrenceKeys)
    ? candidate.skippedOccurrenceKeys.filter((k): k is string => typeof k === 'string')
    : [];

  const rawClosingDay = candidate.settings?.cycleClosingDay;
  const cycleClosingDay =
    typeof rawClosingDay === 'number' &&
    Number.isInteger(rawClosingDay) &&
    rawClosingDay >= 0 &&
    rawClosingDay <= 28
      ? rawClosingDay
      : 0;

  return {
    version: typeof candidate.version === 'number' ? candidate.version : 2,
    isDemoData: Boolean(candidate.isDemoData),
    transactions: validTransactions,
    recurringRules: validRules,
    skippedOccurrenceKeys: validSkipped,
    categories:
      validCategories.length > 0
        ? validCategories
        : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    reserveMovements: validReserve,
    goals: validGoals,
    profile:
      candidate.profile && typeof candidate.profile === 'object'
        ? {
            ...fallback.profile,
            ...candidate.profile,
            email: account?.email ?? candidate.profile.email ?? fallback.profile.email,
          }
        : fallback.profile,
    settings: { cycleClosingDay },
  };
}

/**
 * Valida e analisa um arquivo JSON de backup exportado pelo Teto Finance antes de restaurá-lo.
 * Mantém isolamento da conta ativa (e-mail/identidade da sessão) e rejeita dados malformados.
 */
export function validateAndParseBackupJson(
  rawJsonText: string,
  activeProfile: BudgetProfile
): BackupValidationResult | BackupValidationError {
  if (!rawJsonText || typeof rawJsonText !== 'string' || !rawJsonText.trim()) {
    return { ok: false, error: 'O arquivo de backup está vazio.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch {
    return { ok: false, error: 'Arquivo JSON inválido ou corrompido.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Estrutura de backup incompatível com o Teto Finance.' };
  }

  const candidate = parsed as Partial<WorkspaceState>;

  if (!Array.isArray(candidate.transactions)) {
    return { ok: false, error: 'Backup inválido: lista de movimentações ausente.' };
  }
  if (!Array.isArray(candidate.categories) || candidate.categories.length === 0) {
    return { ok: false, error: 'Backup inválido: lista de categorias ausente.' };
  }

  for (let i = 0; i < candidate.transactions.length; i++) {
    if (!isValidTransaction(candidate.transactions[i])) {
      return {
        ok: false,
        error: `Backup rejeitado: lançamento #${i + 1} possui campos inválidos ou valor não positivo.`,
      };
    }
  }

  const validCategories = candidate.categories.filter(isValidCategory);
  if (validCategories.length !== candidate.categories.length) {
    return { ok: false, error: 'Backup rejeitado: uma ou mais categorias são inválidas.' };
  }

  const rawRules = candidate.recurringRules ?? [];
  if (!Array.isArray(rawRules) || !rawRules.every(isValidRecurringRule)) {
    return { ok: false, error: 'Backup rejeitado: regras recorrentes inválidas.' };
  }

  const rawReserve = candidate.reserveMovements ?? [];
  if (!Array.isArray(rawReserve) || !rawReserve.every(isValidReserveMovement)) {
    return { ok: false, error: 'Backup rejeitado: movimentações da reserva inválidas.' };
  }

  const rawGoals = candidate.goals ?? [];
  if (!Array.isArray(rawGoals) || !rawGoals.every(isValidGoal)) {
    return { ok: false, error: 'Backup rejeitado: metas financeiras inválidas.' };
  }

  const rawSkipped = candidate.skippedOccurrenceKeys ?? [];
  if (!Array.isArray(rawSkipped) || !rawSkipped.every((k) => typeof k === 'string')) {
    return { ok: false, error: 'Backup rejeitado: lista de ocorrências ignoradas inválida.' };
  }

  const closingDay = candidate.settings?.cycleClosingDay ?? 0;
  if (!Number.isInteger(closingDay) || closingDay < 0 || closingDay > 28) {
    return { ok: false, error: 'Backup rejeitado: dia de fechamento do ciclo deve estar entre 0 e 28.' };
  }

  const p = candidate.profile;
  const restoredProfile: BudgetProfile = {
    name: typeof p?.name === 'string' && p.name.trim().length >= 2 ? p.name.trim() : activeProfile.name,
    roleLabel:
      typeof p?.roleLabel === 'string' && p.roleLabel.trim()
        ? p.roleLabel.trim()
        : activeProfile.roleLabel,
    email: activeProfile.email, // Isolamento: mantém o e-mail da conta autenticada
    monthlyNetIncomeCents:
      typeof p?.monthlyNetIncomeCents === 'number' && Number.isInteger(p.monthlyNetIncomeCents) && p.monthlyNetIncomeCents >= 0
        ? p.monthlyNetIncomeCents
        : activeProfile.monthlyNetIncomeCents,
    monthlyFixedExpensesCents:
      typeof p?.monthlyFixedExpensesCents === 'number' && Number.isInteger(p.monthlyFixedExpensesCents) && p.monthlyFixedExpensesCents >= 0
        ? p.monthlyFixedExpensesCents
        : activeProfile.monthlyFixedExpensesCents,
    monthlyReserveGoalCents:
      typeof p?.monthlyReserveGoalCents === 'number' && Number.isInteger(p.monthlyReserveGoalCents) && p.monthlyReserveGoalCents >= 0
        ? p.monthlyReserveGoalCents
        : activeProfile.monthlyReserveGoalCents,
    emergencyReserveTargetCents:
      typeof p?.emergencyReserveTargetCents === 'number' && Number.isInteger(p.emergencyReserveTargetCents) && p.emergencyReserveTargetCents > 0
        ? p.emergencyReserveTargetCents
        : activeProfile.emergencyReserveTargetCents,
    plan: p?.plan === 'premium' ? 'premium' : 'free',
    proactiveAlerts: typeof p?.proactiveAlerts === 'boolean' ? p.proactiveAlerts : activeProfile.proactiveAlerts,
    biometricLock: typeof p?.biometricLock === 'boolean' ? p.biometricLock : activeProfile.biometricLock,
    level: typeof p?.level === 'number' && Number.isInteger(p.level) && p.level >= 1 ? p.level : activeProfile.level,
  };

  const workspace: WorkspaceState = {
    version: 2,
    isDemoData: false,
    transactions: candidate.transactions,
    recurringRules: rawRules,
    skippedOccurrenceKeys: rawSkipped,
    categories: validCategories,
    reserveMovements: rawReserve,
    goals: rawGoals,
    profile: restoredProfile,
    settings: { cycleClosingDay: closingDay },
  };

  return {
    ok: true,
    workspace,
    summary: {
      transactionsCount: workspace.transactions.length,
      recurringRulesCount: workspace.recurringRules.length,
      reserveMovementsCount: workspace.reserveMovements.length,
      goalsCount: workspace.goals.length,
      categoriesCount: workspace.categories.length,
    },
  };
}

function migrateLegacyAccountIfNeeded(rawAcc: Record<string, unknown>): LocalAccount | null {
  if (typeof rawAcc.id !== 'string' || typeof rawAcc.email !== 'string' || typeof rawAcc.name !== 'string') {
    return null;
  }

  // Se for conta demo padrão, garante uso dos hashes canônicos sem senha em texto puro
  const demoMatch = DEMO_ACCOUNTS.find((d) => d.id === rawAcc.id);
  if (demoMatch) {
    return { ...demoMatch };
  }

  if (typeof rawAcc.passwordHash === 'string' && typeof rawAcc.passwordSalt === 'string') {
    return {
      id: rawAcc.id,
      name: rawAcc.name,
      email: rawAcc.email,
      passwordHash: rawAcc.passwordHash,
      passwordSalt: rawAcc.passwordSalt,
      roleLabel: typeof rawAcc.roleLabel === 'string' ? rawAcc.roleLabel : 'Orçamento Pessoal',
      isDemo: Boolean(rawAcc.isDemo),
    };
  }

  // Migra contas legadas que ainda possuíam campo "password" em texto puro
  if (typeof rawAcc.password === 'string' && rawAcc.password.length > 0) {
    const salt = generateSalt();
    const hash = sha256HexSync(`${salt}:${rawAcc.password}`);
    return {
      id: rawAcc.id,
      name: rawAcc.name,
      email: rawAcc.email,
      passwordSalt: salt,
      passwordHash: hash,
      roleLabel: typeof rawAcc.roleLabel === 'string' ? rawAcc.roleLabel : 'Orçamento Pessoal',
      isDemo: Boolean(rawAcc.isDemo),
    };
  }

  return null;
}

export function loadAccounts(): LocalAccount[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) {
      window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEMO_ACCOUNTS));
      return DEMO_ACCOUNTS.map((a) => ({ ...a }));
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEMO_ACCOUNTS));
      return DEMO_ACCOUNTS.map((a) => ({ ...a }));
    }

    let migratedAny = false;
    const cleaned: LocalAccount[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        migratedAny = true;
        continue;
      }
      const rawObj = item as Record<string, unknown>;
      if ('password' in rawObj) migratedAny = true;
      const migrated = migrateLegacyAccountIfNeeded(rawObj);
      if (migrated) cleaned.push(migrated);
      else migratedAny = true;
    }

    if (cleaned.length === 0) {
      window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEMO_ACCOUNTS));
      return DEMO_ACCOUNTS.map((a) => ({ ...a }));
    }

    if (migratedAny) {
      window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(cleaned));
    }

    return cleaned;
  } catch {
    return DEMO_ACCOUNTS.map((a) => ({ ...a }));
  }
}

export function saveAccounts(accounts: LocalAccount[]): StorageWriteResult {
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    return { ok: true };
  } catch (error) {
    console.error('Erro ao salvar contas locais:', error);
    return {
      ok: false,
      error: 'Não foi possível gravar a lista de contas no armazenamento local do navegador.',
    };
  }
}

export function loadSession(): AppSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY) ?? window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppSession>;
    if (!parsed || typeof parsed.accountId !== 'string') return null;
    return {
      accountId: parsed.accountId,
      rememberMe: Boolean(parsed.rememberMe),
      authenticatedAt: parsed.authenticatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveSession(session: AppSession): StorageWriteResult {
  try {
    if (session.rememberMe) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.sessionStorage.removeItem(SESSION_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.localStorage.removeItem(SESSION_KEY);
    }
    return { ok: true };
  } catch (error) {
    console.error('Erro ao salvar sessão:', error);
    return {
      ok: false,
      error: 'Falha ao persistir a sessão no navegador.',
    };
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export async function authenticateLocalAccount(
  emailInput: string,
  passwordInput: string
): Promise<{ ok: true; account: LocalAccount } | { ok: false; error: string }> {
  const email = emailInput.trim().toLowerCase();
  if (!email) {
    return { ok: false, error: 'Informe seu e-mail para entrar.' };
  }
  if (!passwordInput) {
    return { ok: false, error: 'Informe sua senha de acesso.' };
  }

  const accounts = loadAccounts();
  const found = accounts.find((a) => a.email.toLowerCase() === email);
  if (!found) {
    return {
      ok: false,
      error: 'Conta não encontrada neste navegador. Use um perfil demo ou crie uma conta local.',
    };
  }

  const computedHash = await hashPasswordWithSalt(passwordInput, found.passwordSalt);
  // Fallback para compatibilidade se uma conta foi migrada usando sha256HexSync com WebCrypto idêntico
  if (computedHash !== found.passwordHash) {
    return { ok: false, error: 'Senha incorreta para esta conta.' };
  }

  return { ok: true, account: found };
}

export async function registerLocalAccount(input: {
  name: string;
  email: string;
  password: string;
}): Promise<
  | { ok: true; account: LocalAccount; workspace: WorkspaceState }
  | { ok: false; error: string }
> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (name.length < 2) {
    return { ok: false, error: 'Informe seu nome completo.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Informe um e-mail válido.' };
  }
  if (password.length < 4) {
    return { ok: false, error: 'A senha deve ter pelo menos 4 caracteres.' };
  }

  const accounts = loadAccounts();
  if (accounts.some((a) => a.email.toLowerCase() === email)) {
    return { ok: false, error: 'Já existe uma conta cadastrada com este e-mail neste navegador.' };
  }

  const passwordSalt = generateSalt();
  const passwordHash = await hashPasswordWithSalt(password, passwordSalt);

  const newAccount: LocalAccount = {
    id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    passwordSalt,
    passwordHash,
    roleLabel: 'Orçamento Pessoal',
    isDemo: false,
  };

  const accountsWrite = saveAccounts([...accounts, newAccount]);
  if (!accountsWrite.ok) {
    return { ok: false, error: accountsWrite.error ?? 'Erro ao salvar nova conta.' };
  }

  const workspace = createEmptyWorkspace({ name, email, roleLabel: 'Orçamento Pessoal' });
  const wsWrite = financialRepository.saveForAccount(newAccount.id, workspace);
  if (!wsWrite.ok) {
    return { ok: false, error: wsWrite.error ?? 'Erro ao inicializar dados da conta.' };
  }

  return { ok: true, account: newAccount, workspace };
}

export class LocalStorageRepository {
  loadForAccountSafe(accountId: string): StorageLoadResult {
    const key = `${WORKSPACE_PREFIX}${accountId}`;
    const accounts = loadAccounts();
    const account = accounts.find((a) => a.id === accountId);

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        const seeded = getFallbackWorkspace(account);
        const saveRes = this.saveForAccount(accountId, seeded);
        return {
          ok: saveRes.ok,
          workspace: seeded,
          error: saveRes.error,
        };
      }

      const parsed = JSON.parse(raw);
      const sanitized = sanitizeState(parsed, account);
      if (!sanitized) {
        // Preserva o conteúdo bruto antes de restaurar o estado seguro da própria conta
        try {
          window.localStorage.setItem(`${key}_corrupted_backup`, raw);
        } catch {
          // ignore backup failure
        }
        const fallback = getFallbackWorkspace(account);
        this.saveForAccount(accountId, fallback);
        return {
          ok: false,
          workspace: fallback,
          error:
            'Os dados salvos desta conta estavam corrompidos e foram reinicializados com segurança (cópia de diagnóstico preservada).',
        };
      }

      return { ok: true, workspace: sanitized };
    } catch {
      const fallback = getFallbackWorkspace(account);
      return {
        ok: false,
        workspace: fallback,
        error: 'Não foi possível ler o armazenamento local desta conta.',
      };
    }
  }

  loadForAccount(accountId: string): WorkspaceState {
    return this.loadForAccountSafe(accountId).workspace;
  }

  saveForAccount(accountId: string, state: WorkspaceState): StorageWriteResult {
    const key = `${WORKSPACE_PREFIX}${accountId}`;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
      return { ok: true };
    } catch (error) {
      console.error('Erro ao salvar dados no armazenamento local:', error);
      return {
        ok: false,
        error:
          'Falha ao salvar alterações no armazenamento local (espaço cheio ou bloqueado). Exporte um backup JSON para não perder dados.',
      };
    }
  }

  resetToDemoForAccount(accountId: string): WorkspaceState {
    const demo = createDemoWorkspaceForAccount(accountId);
    this.saveForAccount(accountId, demo);
    return demo;
  }

  resetToEmptyForAccount(
    accountId: string,
    existingProfile?: WorkspaceState['profile']
  ): WorkspaceState {
    const empty = createEmptyWorkspace(
      existingProfile
        ? {
            name: existingProfile.name,
            email: existingProfile.email,
            roleLabel: existingProfile.roleLabel,
          }
        : undefined
    );
    if (existingProfile) {
      empty.profile.plan = existingProfile.plan;
      empty.profile.proactiveAlerts = existingProfile.proactiveAlerts;
      empty.profile.biometricLock = existingProfile.biometricLock;
    }
    this.saveForAccount(accountId, empty);
    return empty;
  }
}

export const financialRepository = new LocalStorageRepository();
