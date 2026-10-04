import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Day() {
  const t = copy[useLocale().locale];
  const reveal = useStaggeredReveal(6);

  return (
    <section
      id="day"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.dayTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.daySub}</p>
      </div>

      <div className="flex flex-col gap-1.5 md:gap-2">
        {t.moments.map((m, i) => (
          <div
            key={m.time}
            className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-6 grid grid-cols-1 md:grid-cols-[120px_1fr] gap-2 md:gap-6 items-start"
            style={reveal.getAnimStyle(i + 1)}
          >
            <span className="text-lg md:text-xl font-semibold tracking-[-0.01em] text-teal">{m.time}</span>
            <p className="text-sm md:text-base font-medium leading-6 md:leading-7 text-fog max-w-[68ch]">{m.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
