import type { ReactNode } from 'react';
import { TETO_LOGO_SRC } from '../assets/tetoLogo';

export type AppView =
  | 'dashboard'
  | 'reports'
  | 'quick-record'
  | 'goals'
  | 'profile'
  | 'plans'
  | 'ai-chat'
  | 'statement';

export interface ToastNotice {
  id: string;
  message: string;
  tone?: 'success' | 'warning' | 'error';
}

interface StitchShellProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  backTo?: AppView;
  isBrandHeader?: boolean;
  headerRight?: ReactNode;
  showBottomNav?: boolean;
  toasts?: ToastNotice[];
  children: ReactNode;
}

export function StitchShell({
  activeView,
  onNavigate,
  title,
  subtitle,
  showBack = false,
  backTo = 'dashboard',
  isBrandHeader = false,
  headerRight,
  showBottomNav = true,
  toasts = [],
  children,
}: StitchShellProps) {
  const navActive = (tab: AppView) => activeView === tab;

  return (
    <div className="min-h-screen bg-[#0B0C10] text-dark-on-surface font-body antialiased selection:bg-primary selection:text-on-primary">
      <div className="w-full max-w-[420px] md:max-w-[780px] lg:max-w-[1040px] mx-auto min-h-screen flex flex-col justify-between border-x border-dark-outline/40 shadow-2xl relative bg-dark-surface">
        {/* Top Floating Toasts */}
        {toasts.length > 0 && (
          <div
            aria-live="polite"
            className="fixed top-4 left-1/2 -translate-x-1/2 max-w-[390px] w-[90%] z-50 space-y-2 pointer-events-none"
          >
            {toasts.map((t) => {
              const icon =
                t.tone === 'error'
                  ? 'error'
                  : t.tone === 'warning'
                  ? 'warning'
                  : 'check_circle';
              const iconColor =
                t.tone === 'error'
                  ? 'text-error'
                  : t.tone === 'warning'
                  ? 'text-warning'
                  : 'text-success';
              return (
                <div
                  key={t.id}
                  className="p-3 rounded-DEFAULT bg-dark-surface-variant border border-primary/50 text-dark-on-surface text-xs font-medium shadow-xl flex items-center gap-2 pointer-events-auto"
                >
                  <span className={`material-symbols-outlined text-base flex-shrink-0 ${iconColor}`}>
                    {icon}
                  </span>
                  <span className="flex-1 leading-snug">{t.message}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Top Header */}
        <header className="px-5 md:px-7 pt-5 pb-4 flex items-center justify-between gap-3 border-b border-dark-outline/50 sticky top-0 bg-dark-surface/95 backdrop-blur-sm z-20">
          {isBrandHeader ? (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-DEFAULT bg-white p-1 flex items-center justify-center shadow-sm overflow-hidden flex-shrink-0">
                <img
                  src={TETO_LOGO_SRC}
                  alt="Logo Teto Finance"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-headline text-headline-sm text-dark-on-surface leading-tight tracking-tight font-bold">
                    TETO
                  </span>
                  <span className="px-1.5 py-0.5 rounded-sm bg-primary/20 text-accent text-[10px] font-bold uppercase tracking-wider border border-primary/30">
                    Finance
                  </span>
                </div>
                {subtitle && (
                  <p className="text-body-sm text-dark-on-surface-variant text-[11px] leading-tight truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              {showBack && (
                <button
                  type="button"
                  onClick={() => onNavigate(backTo)}
                  aria-label="Voltar ao painel"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-dark-surface-variant text-dark-on-surface-variant hover:text-dark-on-surface border border-dark-outline transition-colors flex-shrink-0 active:scale-90"
                >
                  <span className="material-symbols-outlined text-xl">arrow_back</span>
                </button>
              )}
              <div className="min-w-0">
                <h1 className="font-headline text-headline-sm text-dark-on-surface leading-tight font-bold truncate">
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-body-sm text-dark-on-surface-variant text-[11px] truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Desktop Navigation Bar */}
          {showBottomNav && (
            <nav
              aria-label="Navegação desktop"
              className="hidden md:flex items-center gap-1 bg-dark-surface-variant/70 border border-dark-outline rounded-full px-2 py-1"
            >
              {(
                [
                  { id: 'dashboard', label: 'Teto', icon: 'roofing' },
                  { id: 'reports', label: 'Relatórios', icon: 'monitoring' },
                  { id: 'goals', label: 'Metas', icon: 'military_tech' },
                  { id: 'statement', label: 'Extrato', icon: 'receipt_long' },
                  { id: 'profile', label: 'Perfil', icon: 'person' },
                ] as Array<{ id: AppView; label: string; icon: string }>
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    navActive(item.id)
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-dark-on-surface-variant hover:text-dark-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onNavigate('quick-record')}
                className="ml-1 px-3 py-1.5 rounded-full bg-accent text-on-primary text-xs font-bold flex items-center gap-1 hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Novo</span>
              </button>
            </nav>
          )}

          {headerRight ?? (
            <div className="w-8 h-8 rounded-DEFAULT bg-white p-1 flex items-center justify-center shadow-sm overflow-hidden flex-shrink-0">
              <img
                src={TETO_LOGO_SRC}
                alt="Logo Teto Finance"
                className="w-full h-full object-contain"
              />
            </div>
          )}
        </header>

        {/* Main Content */}
        <main
          className={`flex-1 px-5 md:px-7 py-5 md:py-6 space-y-5 ${
            showBottomNav ? 'pb-24 md:pb-8' : 'pb-10'
          }`}
        >
          {children}
        </main>

        {/* Bottom Navigation Bar (Mobile App Shell) */}
        {showBottomNav && (
          <nav
            aria-label="Navegação principal"
            className="md:hidden fixed bottom-0 left-1/2 -translate-x-1/2 max-w-[420px] w-full bg-dark-surface/95 backdrop-blur-sm border-t border-dark-outline px-6 py-2 flex justify-between items-center z-30"
          >
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className={`flex flex-col items-center gap-1 py-1 transition-colors ${
                navActive('dashboard')
                  ? 'text-primary font-semibold'
                  : 'text-dark-on-surface-variant hover:text-dark-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">roofing</span>
              <span className="text-[10px]">Teto</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className={`flex flex-col items-center gap-1 py-1 transition-colors ${
                navActive('reports')
                  ? 'text-primary font-semibold'
                  : 'text-dark-on-surface-variant hover:text-dark-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">monitoring</span>
              <span className="text-[10px]">Relatórios</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('quick-record')}
              aria-label="Registro Rápido de Gasto"
              className="w-12 h-12 -mt-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg shadow-primary/30 border-4 border-dark-surface hover:bg-accent transition-transform duration-150 active:scale-95"
            >
              <span className="material-symbols-outlined text-2xl">add</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('goals')}
              className={`flex flex-col items-center gap-1 py-1 transition-colors ${
                navActive('goals')
                  ? 'text-primary font-semibold'
                  : 'text-dark-on-surface-variant hover:text-dark-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">military_tech</span>
              <span className="text-[10px]">Metas</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className={`flex flex-col items-center gap-1 py-1 transition-colors ${
                navActive('profile')
                  ? 'text-primary font-semibold'
                  : 'text-dark-on-surface-variant hover:text-dark-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">person</span>
              <span className="text-[10px]">Perfil</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
