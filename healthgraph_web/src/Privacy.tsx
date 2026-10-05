import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Privacy() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(5);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section
      id="privacy"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.privacyTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.privacySub}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-1.5 md:gap-2">
        {t.privacyPoints.map((point, i) => (
          <button
            key={point.name}
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            style={reveal.getAnimStyle(i + 1)}
            aria-expanded={open === i}
            className={`text-left rounded-card border p-5 md:p-6 flex flex-col gap-2 min-h-[140px] md:min-h-[180px] transition-colors duration-300 ${
              open === i ? 'bg-white text-black border-white' : 'bg-white/[0.045] border-white/10 text-ink hover:border-white/25'
            }`}
          >
            <h3 className="text-lg md:text-xl font-semibold leading-tight tracking-[-0.01em]">{point.name}</h3>
            <p className={`text-xs md:text-sm font-medium leading-5 ${open === i ? 'text-black/70' : 'text-fog'}`}>
              {point.desc}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}
