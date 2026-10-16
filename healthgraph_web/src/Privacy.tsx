import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Privacy() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(5);

  return (
    <section
      id="privacy"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.privacyTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.privacySub}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        {t.privacyPoints.map((p, i) => (
          <div
            key={p.name}
            className="rounded-card lg-card p-5 md:p-7 flex flex-col gap-2"
            style={reveal.getAnimStyle(i + 1)}
          >
            <h3 className="text-lg md:text-xl font-semibold text-ink">{p.name}</h3>
            <p className="text-xs md:text-sm font-medium leading-5 md:leading-6 text-fog">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
