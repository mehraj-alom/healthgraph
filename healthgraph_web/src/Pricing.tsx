import { useStaggeredReveal } from './hooks';
import { copy, tiers, useLocale } from './i18n';

export default function Pricing() {
  const { locale } = useLocale();
  const t = copy[locale];
  const list = tiers[locale];
  const reveal = useStaggeredReveal(4);

  return (
    <section
      id="pricing"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.pricingTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.pricingSub}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 md:gap-2">
        {list.map((tier, i) => (
          <div
            key={tier.name}
            className={`rounded-card border p-5 md:p-7 flex flex-col gap-4 ${
              tier.best ? 'bg-white text-black border-white' : 'bg-white/[0.045] border-white/10'
            }`}
            style={reveal.getAnimStyle(i + 1)}
          >
            <div className="flex items-center justify-between">
              <h3 className={`text-lg font-semibold ${tier.best ? '' : 'text-ink'}`}>{tier.name}</h3>
              {tier.best && (
                <span className="px-2.5 py-1 rounded-full bg-black text-white text-[11px] font-semibold">
                  {t.recommended}
                </span>
              )}
            </div>
            <p className="text-3xl font-semibold tracking-[-0.02em]">
              {tier.price}
              <span className="text-sm font-medium opacity-60"> {tier.per}</span>
            </p>
            <ul className="flex flex-col gap-2">
              {tier.features.map((f) => (
                <li key={f} className={`text-xs md:text-sm font-medium ${tier.best ? 'text-black/70' : 'text-fog'}`}>
                  · {f}
                </li>
              ))}
            </ul>
            <a
              href="#early-access"
              className={`inline-flex items-center justify-center rounded-full text-sm font-semibold px-6 py-3 mt-auto ${
                tier.best ? 'bg-black text-white' : 'border border-white/20 text-ink'
              }`}
            >
              {tier.cta}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
