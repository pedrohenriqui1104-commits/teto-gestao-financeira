import { useState } from 'react';
import { addDaysISO, formatDateBR } from '../domain/formatters';
import type { PlanTier } from '../domain/types';
import { StitchShell, type AppView, type ToastNotice } from './StitchShell';

interface PlansViewProps {
  currentPlan: PlanTier;
  referenceDate: string;
  onNavigate: (view: AppView) => void;
  onSelectPlan: (plan: PlanTier, paymentMethod?: 'pix' | 'cartao') => void;
  toasts: ToastNotice[];
}

export function PlansView({
  currentPlan,
  referenceDate,
  onNavigate,
  onSelectPlan,
  toasts,
}: PlansViewProps) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cartao'>('pix');

  const isPremium = currentPlan === 'premium';
  const firstChargeDate = formatDateBR(addDaysISO(referenceDate, 7));

  return (
    <StitchShell
      activeView="plans"
      onNavigate={onNavigate}
      showBack
      backTo="dashboard"
      showBottomNav={false}
      title="Planos Teto Finance"
      subtitle="Modelo Freemium transparente"
      toasts={toasts}
    >
      {/* Value Proposition Header */}
      <section className="text-center space-y-2 pt-2">
        <span className="px-3 py-1 rounded-full bg-primary/20 text-accent font-headline text-label-sm font-bold border border-primary/30 uppercase tracking-wider inline-block">
          Planejamento Inteligente
        </span>
        <h2 className="font-headline text-headline-lg text-dark-on-surface font-extrabold">
          Decisões conscientes sem ansiedade financeira
        </h2>
        <p className="text-body-sm text-dark-on-surface-variant text-xs max-w-xs mx-auto leading-relaxed">
          Comece grátis ou acelere sua reserva com recursos preditivos de análise inteligente.
        </p>
      </section>

      {/* Plan Cards Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 items-start">
        {/* Premium Plan */}
        <article className="p-5 rounded-lg bg-gradient-to-b from-[#24181B] via-dark-surface-variant to-dark-surface-variant border-2 border-primary relative shadow-xl overflow-hidden">
          <div className="absolute -right-10 -top-10 w-28 h-28 rounded-full bg-primary/20 blur-xl pointer-events-none" />

          <div className="flex items-start justify-between mb-3 gap-2">
            <div>
              <span className="px-2.5 py-0.5 rounded-full bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider">
                {isPremium ? 'Plano Ativo' : 'Mais Escolhido'}
              </span>
              <h3 className="font-headline text-headline-md font-bold text-dark-on-surface mt-2">
                Plano Premium
              </h3>
              <p className="text-body-sm text-dark-on-surface-variant text-[11px]">
                Para quem deseja controle total automatizado
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="flex items-baseline justify-end gap-0.5">
                <span className="text-xs font-semibold text-accent">R$</span>
                <span className="font-headline text-headline-lg font-extrabold text-dark-on-surface tabular-nums">
                  19,90
                </span>
              </div>
              <span className="text-[10px] text-dark-on-surface-variant">por mês</span>
            </div>
          </div>

          <ul className="space-y-2.5 py-3 border-t border-dark-outline/70 my-2 text-[12px]">
            <li className="flex items-center gap-2 text-dark-on-surface">
              <span className="material-symbols-outlined text-primary text-base flex-shrink-0">
                check_circle
              </span>
              <span>
                <strong>Leitor Inteligente com IA:</strong> categorização preditiva de impulsos
              </span>
            </li>
            <li className="flex items-center gap-2 text-dark-on-surface">
              <span className="material-symbols-outlined text-primary text-base flex-shrink-0">
                check_circle
              </span>
              <span>
                <strong>Radar de Microgastos Invisíveis:</strong> detecção por horários e categorias
              </span>
            </li>
            <li className="flex items-center gap-2 text-dark-on-surface">
              <span className="material-symbols-outlined text-primary text-base flex-shrink-0">
                check_circle
              </span>
              <span>
                <strong>Alertas comportamentais:</strong> lembretes preventivos e metas ilimitadas
              </span>
            </li>
            <li className="flex items-center gap-2 text-dark-on-surface">
              <span className="material-symbols-outlined text-primary text-base flex-shrink-0">
                check_circle
              </span>
              <span>
                <strong>Relatórios avançados:</strong> diagnóstico completo e exportação CSV
              </span>
            </li>
          </ul>

          <div className="pt-2">
            {isPremium ? (
              <div className="space-y-2">
                <div className="w-full py-3 px-4 rounded-DEFAULT bg-success/15 border border-success/40 text-success font-headline text-label-md font-bold flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-lg">verified</span>
                  <span>Assinatura Teto Premium Ativa</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectPlan('free')}
                  className="w-full py-2 px-4 rounded-DEFAULT bg-dark-surface border border-dark-outline text-[11px] text-dark-on-surface-variant hover:text-dark-on-surface font-semibold"
                >
                  Voltar para Plano Gratuito
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCheckoutOpen(true)}
                className="w-full py-3.5 px-4 rounded-DEFAULT bg-primary text-on-primary font-headline text-label-md font-bold shadow-lg shadow-primary/30 hover:bg-accent flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <span>Assinar Plano Premium (7 dias grátis)</span>
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
            )}
          </div>
        </article>

        {/* Free Plan */}
        <article className="p-5 rounded-lg bg-dark-surface-variant border border-dark-outline">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-headline text-headline-sm font-bold text-dark-on-surface">
                Plano Gratuito
              </h3>
              <p className="text-body-sm text-dark-on-surface-variant text-[11px]">
                Essencial para quem está começando
              </p>
            </div>
            <div className="text-right">
              <span className="font-headline text-headline-sm font-bold text-dark-on-surface">
                R$ 0
              </span>
              <p className="text-[10px] text-dark-on-surface-variant">sempre grátis</p>
            </div>
          </div>

          <ul className="space-y-2 py-3 border-t border-dark-outline/70 my-2 text-[12px] text-dark-on-surface-variant">
            <li className="flex items-center gap-2">
              <span className="material-symbols-outlined text-dark-on-surface-variant text-base flex-shrink-0">
                check
              </span>
              <span>Painel do Orçamento Reverso (Teto, Fixos e Reserva)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="material-symbols-outlined text-dark-on-surface-variant text-base flex-shrink-0">
                check
              </span>
              <span>Registro manual rápido com botão de ação rápida</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="material-symbols-outlined text-dark-on-surface-variant text-base flex-shrink-0">
                check
              </span>
              <span>Consumo semanal do teto e controle de recorrências</span>
            </li>
          </ul>

          <div className="pt-1">
            <button
              type="button"
              disabled={!isPremium}
              onClick={() => onSelectPlan('free')}
              className={`w-full py-2.5 px-4 rounded-DEFAULT border font-headline text-label-sm font-medium ${
                !isPremium
                  ? 'bg-dark-surface border-dark-outline text-dark-on-surface-variant cursor-default'
                  : 'bg-dark-surface border-dark-outline text-dark-on-surface hover:border-primary/50'
              }`}
            >
              {!isPremium ? 'Seu Plano Atual' : 'Selecionar Plano Gratuito'}
            </button>
          </div>
        </article>
      </div>

      {/* Trust signals & cancellation note */}
      <div className="p-4 rounded-DEFAULT bg-dark-surface-variant/40 border border-dark-outline/60 text-center space-y-1.5">
        <div className="flex items-center justify-center gap-2 text-dark-on-surface text-label-sm font-semibold">
          <span className="material-symbols-outlined text-success text-base">verified</span>
          <span>Cancele a qualquer momento sem taxas</span>
        </div>
        <p className="text-[11px] text-dark-on-surface-variant">
          Simulação demonstrativa local de assinatura (sem cobrança real).
        </p>
      </div>

      {/* Checkout Modal */}
      {checkoutOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCheckoutOpen(false);
          }}
        >
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-primary/50 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-dark-outline pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">
                  workspace_premium
                </span>
                <h3 id="checkout-modal-title" className="font-headline text-headline-sm text-dark-on-surface font-bold">
                  Ativar Premium
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                aria-label="Fechar checkout"
                className="w-8 h-8 rounded-full bg-dark-surface text-dark-on-surface-variant hover:text-dark-on-surface flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="p-3 rounded bg-dark-surface border border-primary/30 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-dark-on-surface-variant">Plano Selecionado:</span>
                <span className="font-bold text-dark-on-surface">Teto Premium Mensal</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-dark-on-surface-variant">Período de Teste (Demo):</span>
                <span className="font-bold text-success">7 dias grátis</span>
              </div>
              <div className="flex justify-between text-xs border-t border-dark-outline pt-1">
                <span className="text-dark-on-surface-variant">
                  Primeira cobrança em {firstChargeDate}:
                </span>
                <span className="font-bold text-accent tabular-nums">R$ 19,90/mês</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] text-dark-on-surface-variant block">
                Forma de Pagamento (Demonstração)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('pix')}
                  className={`p-2.5 rounded border text-center text-xs font-bold transition-colors ${
                    paymentMethod === 'pix'
                      ? 'bg-primary/20 border-primary text-dark-on-surface'
                      : 'bg-dark-surface border-dark-outline text-dark-on-surface-variant'
                  }`}
                >
                  Pix Automático
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cartao')}
                  className={`p-2.5 rounded border text-center text-xs font-bold transition-colors ${
                    paymentMethod === 'cartao'
                      ? 'bg-primary/20 border-primary text-dark-on-surface'
                      : 'bg-dark-surface border-dark-outline text-dark-on-surface-variant'
                  }`}
                >
                  Cartão de Crédito
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="flex-1 py-2.5 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectPlan('premium', paymentMethod);
                  setCheckoutOpen(false);
                }}
                className="flex-1 py-2.5 rounded-DEFAULT bg-primary text-on-primary text-xs font-bold hover:bg-accent"
              >
                Confirmar Ativação
              </button>
            </div>
          </div>
        </div>
      )}
    </StitchShell>
  );
}
