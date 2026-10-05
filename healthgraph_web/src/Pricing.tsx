import { useStaggeredReveal } from './hooks';
import { copy, tiers, useLocale } from './i18n';

export default function Pricing() {
  const { locale } = useLocale();
  const t = copy[locale];
  const plans = tiers[locale];
  const reveal = useStaggeredReveal(4);

  return (
    <section id="pricing" ref={reveal.containerRef} className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage">
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.pricingTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.pricingSub}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 md:gap-2">
        {plans.map((plan, i) => (
          <div
            key={plan.name}
            style={reveal.getAnimStyle(i + 1)}
            className={`relative rounded-card p-5 md:p-7 flex flex-col gap-4 min-h-[280px] ${
              plan.best
                ? 'bg-white text-black ring-cobalt'
                : 'bg-white/[0.045] border border-white/10 text-ink'
            }`}
          >
            {plan.best && (
              <span className="absolute -top-3 left-5 px-3 py-1 rounded-full bg-stage border border-cobalt/60 text-cobalt text-[11px] font-semibold tracking-wide">
                {t.recommended}
              </span>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xl md:text-2xl font-semibold tracking-[-0.01em]">{plan.name}</h3>
              <p className="font-semibold tabular-nums whitespace-nowrap">
                <span className="text-2xl md:text-3xl tracking-[-0.02em]">{plan.price}</span>
                <span className={`text-xs font-medium ${plan.best ? 'text-black/55' : 'text-fog'}`}> {plan.per}</span>
              </p>
            </div>
            <ul className="flex flex-col gap-2.5 flex-1">
              {plan.features.map((f) => (
                <li key={f} className={`text-sm font-medium flex gap-2.5 ${plan.best ? 'text-black/75' : 'text-white/75'}`}>
                  <span aria-hidden className={plan.best ? 'text-black/40' : 'text-white/35'}>○</span>{f}
                </li>
              ))}
            </ul>
            <a
              href="#early-access"
              className={`text-center px-6 py-3.5 rounded-full text-sm font-semibold active:scale-[0.98] ${
                plan.best
                  ? 'btn-cobalt'
                  : 'bg-white text-black hover:bg-white/90 transition-all duration-200'
              }`}
            >
              {plan.cta}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
