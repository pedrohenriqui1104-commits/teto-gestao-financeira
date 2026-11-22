import { useState, type FormEvent } from 'react';
import { TETO_LOGO_SRC } from '../assets/tetoLogo';
import type { LocalAccount } from '../domain/types';

interface LoginViewProps {
  accounts: LocalAccount[];
  onAuthenticate: (
    email: string,
    password: string,
    rememberMe: boolean
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onQuickDemoLogin: (accountId: string, rememberMe: boolean) => void;
  onRegister: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function LoginView({
  accounts,
  onAuthenticate,
  onQuickDemoLogin,
  onRegister,
}: LoginViewProps) {
  const [email, setEmail] = useState('lucas.gabriel@email.com');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('lucas.gabriel@email.com');

  const [signupOpen, setSignupOpen] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSubmitting, setSignupSubmitting] = useState(false);

  const demoAccounts = accounts.filter((a) => a.isDemo);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await onAuthenticate(email, password, rememberMe);
      if (!res.ok) {
        setFormError(res.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSignupError(null);
    setSignupSubmitting(true);
    try {
      const res = await onRegister({
        name: signupName,
        email: signupEmail,
        password: signupPassword,
      });
      if (!res.ok) {
        setSignupError(res.error);
      }
    } finally {
      setSignupSubmitting(false);
    }
  };

  return (
    <div className="bg-[#0B0C10] text-dark-on-surface font-body min-h-screen md:flex md:items-center md:justify-center md:py-8 md:px-4 antialiased selection:bg-primary selection:text-on-primary">
      <div className="w-full max-w-[440px] mx-auto min-h-screen md:min-h-0 flex flex-col justify-between border-x md:border border-dark-outline/60 md:rounded-2xl shadow-2xl relative bg-dark-surface p-6">
        {toastMsg && (
          <div className="fixed top-5 left-1/2 -translate-x-1/2 max-w-xs w-[90%] z-50 p-3 rounded-DEFAULT bg-dark-surface-variant border border-primary/50 text-dark-on-surface text-xs font-medium shadow-xl flex items-center gap-2">
            <span className="material-symbols-outlined text-success text-base flex-shrink-0">
              check_circle
            </span>
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Top Branding & Intro */}
        <div className="space-y-6 pt-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-20 h-20 rounded-2xl bg-white p-2.5 flex items-center justify-center shadow-lg shadow-primary/10 overflow-hidden ring-4 ring-dark-surface-variant">
              <img
                src={TETO_LOGO_SRC}
                alt="Logo Teto Finance"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="font-headline text-display-lg-mobile text-dark-on-surface font-extrabold tracking-tight">
                  TETO
                </h1>
                <span className="px-2 py-0.5 rounded-sm bg-primary/20 text-accent text-xs font-bold uppercase tracking-wider border border-primary/30">
                  Finance
                </span>
              </div>
              <p className="text-body-sm text-dark-on-surface-variant text-xs mt-1">
                Planejamento inteligente, decisões conscientes.
              </p>
            </div>
          </div>

          {/* Quick Persona Switcher (1 clique) */}
          <div className="p-3.5 rounded-DEFAULT bg-dark-surface-variant/70 border border-dark-outline space-y-2">
            <div className="flex items-center justify-between text-[11px] gap-2">
              <span className="font-semibold text-dark-on-surface flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-primary">
                  account_circle
                </span>
                Perfis Demo (1 clique):
              </span>
              <span className="text-[10px] text-accent font-semibold">Senha: teto@2026</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {demoAccounts.map((acc) => {
                const subtitle = acc.id === 'demo-lucas'
                  ? 'Desconectado Impulsivo'
                  : 'Planejadora';
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => onQuickDemoLogin(acc.id, rememberMe)}
                    className="p-2.5 rounded bg-dark-surface border border-dark-outline hover:border-primary/60 text-left text-[11px] transition-colors active:scale-[0.98]"
                  >
                    <p className="font-semibold text-dark-on-surface">{acc.name}</p>
                    <p className="text-[10px] text-dark-on-surface-variant">{subtitle}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Form Inputs */}
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            {formError && (
              <div
                role="alert"
                className="p-3 rounded-DEFAULT bg-error/10 border border-error/40 text-xs text-error flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-base flex-shrink-0">error</span>
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="loginEmail"
                className="block text-label-sm font-semibold text-dark-on-surface mb-1.5"
              >
                E-mail ou Usuário
              </label>
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-3.5 text-dark-on-surface-variant text-lg">
                  mail
                </span>
                <input
                  id="loginEmail"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-dark-on-surface placeholder-dark-on-surface-variant text-body-md focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                  placeholder="seu.email@exemplo.com"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="loginPass"
                  className="block text-label-sm font-semibold text-dark-on-surface"
                >
                  Senha de Acesso
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryEmail(email);
                    setForgotOpen(true);
                  }}
                  className="text-[11px] text-accent hover:underline font-medium"
                >
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-3.5 text-dark-on-surface-variant text-lg">
                  lock
                </span>
                <input
                  id="loginPass"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline text-dark-on-surface placeholder-dark-on-surface-variant text-body-md focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Digite sua senha (demo: teto@2026)"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label="Revelar senha"
                  className="absolute right-3.5 text-dark-on-surface-variant hover:text-dark-on-surface"
                >
                  <span className="material-symbols-outlined text-lg">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-dark-on-surface-variant">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded bg-dark-surface-variant border-dark-outline text-primary focus:ring-primary focus:ring-offset-dark-surface"
                />
                <span>Lembrar neste navegador</span>
              </label>
              <span className="text-[11px] text-success flex items-center gap-1 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                Dados salvos localmente
              </span>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 px-4 rounded-DEFAULT bg-primary text-on-primary font-headline text-label-lg font-bold shadow-lg shadow-primary/30 hover:bg-accent disabled:opacity-60 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <span>{submitting ? 'Verificando...' : 'Entrar no Teto Finance'}</span>
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
            </div>
          </form>

          {/* Demo-only Fast Access Trigger (nunca contorna senha de contas cadastradas) */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                const typedEmail = email.trim().toLowerCase();
                const matchedAccount = accounts.find((a) => a.email.toLowerCase() === typedEmail);
                if (matchedAccount && !matchedAccount.isDemo) {
                  setFormError(
                    'O acesso rápido com 1 clique funciona apenas nos perfis demo. Digite sua senha para entrar nesta conta.'
                  );
                  return;
                }
                const targetDemo = matchedAccount?.isDemo
                  ? matchedAccount.id
                  : demoAccounts[0]?.id ?? 'demo-lucas';
                onQuickDemoLogin(targetDemo, rememberMe);
              }}
              className="w-full py-3 px-4 rounded-DEFAULT bg-dark-surface-variant border border-dark-outline hover:border-primary/50 text-dark-on-surface text-label-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined text-primary text-xl">fingerprint</span>
              <span>Entrar no Perfil Demo (1 clique)</span>
            </button>
          </div>
        </div>

        {/* Bottom Sign-up Callout & Honest Local MVP Notice */}
        <div className="pt-6 pb-2 text-center border-t border-dark-outline/60 mt-6 space-y-2.5">
          <p className="text-body-sm text-dark-on-surface-variant text-xs">
            Ainda não tem conta?{' '}
            <button
              type="button"
              onClick={() => {
                setSignupError(null);
                setSignupOpen(true);
              }}
              className="text-accent font-bold hover:underline ml-1"
            >
              Criar conta local grátis
            </button>
          </p>
          <p className="text-[10px] text-dark-on-surface-variant leading-relaxed bg-dark-surface-variant/40 border border-dark-outline/60 rounded-DEFAULT p-2.5">
            MVP offline-first: contas e lançamentos ficam isolados no armazenamento local deste navegador (senhas protegidas com hash SHA-256 local, sem servidor de autenticação em produção).
          </p>
        </div>

        {/* Modal Esqueci Minha Senha */}
        {forgotOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setForgotOpen(false);
            }}
          >
            <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-xl">
                    lock_reset
                  </span>
                  <h3 id="forgot-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                    Recuperar Acesso
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  aria-label="Fechar modal de recuperação"
                  className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <p className="text-[11px] text-dark-on-surface-variant leading-relaxed">
                Como este MVP funciona offline neste navegador, não há envio real de e-mail para recuperação. Os perfis demonstrativos usam a senha padrão{' '}
                <strong className="text-dark-on-surface">teto@2026</strong> ou acesso rápido de 1 clique.
              </p>
              <input
                type="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                aria-label="E-mail de recuperação"
                className="w-full px-3.5 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface text-xs focus:border-primary focus:outline-none"
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-medium hover:border-dark-on-surface-variant"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(false);
                    triggerToast(`Aviso de recuperação local exibido para ${recoveryEmail || 'seu e-mail'}.`);
                  }}
                  className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Criar Conta Grátis */}
        {signupOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signup-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSignupOpen(false);
            }}
          >
            <form
              onSubmit={handleSignupSubmit}
              className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-3.5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-success text-xl">
                    person_add
                  </span>
                  <h3 id="signup-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                    Cadastro Local Teto
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSignupOpen(false)}
                  aria-label="Fechar cadastro"
                  className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <p className="text-[11px] text-dark-on-surface-variant leading-relaxed">
                Crie sua conta local neste navegador com carteira zerada e isolada das demais contas:
              </p>

              {signupError && (
                <div
                  role="alert"
                  className="p-2.5 rounded bg-error/10 border border-error/40 text-[11px] text-error"
                >
                  {signupError}
                </div>
              )}

              <div className="space-y-2">
                <input
                  type="text"
                  required
                  placeholder="Seu nome completo"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface text-xs focus:border-primary focus:outline-none"
                />
                <input
                  type="email"
                  required
                  placeholder="Seu melhor e-mail"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface text-xs focus:border-primary focus:outline-none"
                />
                <input
                  type="password"
                  required
                  placeholder="Crie uma senha (mín. 4 dígitos)"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-dark-on-surface text-xs focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSignupOpen(false)}
                  className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-medium hover:border-dark-on-surface-variant"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={signupSubmitting}
                  className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent disabled:opacity-60"
                >
                  {signupSubmitting ? 'Criando...' : 'Criar e Acessar'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
