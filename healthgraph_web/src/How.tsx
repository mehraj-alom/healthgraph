import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function How() {
  const t = copy[useLocale().locale];
  const reveal = useStaggeredReveal(4);

  return (
    <section
      id="how"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.howTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.howSub}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 md:gap-2">
        {t.steps.map((s, i) => (
          <div
            key={s.num}
            className="rounded-card lg-card p-5 md:p-7 flex flex-col gap-3"
            style={reveal.getAnimStyle(i + 1)}
          >
            <span className="text-xs md:text-sm font-semibold tracking-[0.2em] text-teal">{s.num}</span>
            <h3 className="text-xl md:text-2xl font-semibold tracking-[-0.01em] text-ink">{s.name}</h3>
            <p className="text-xs md:text-sm font-medium leading-5 md:leading-6 text-fog">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
