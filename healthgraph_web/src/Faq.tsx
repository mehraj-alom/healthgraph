import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Faq() {
  const t = copy[useLocale().locale];
  const reveal = useStaggeredReveal(7);
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.faqTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.faqSub}</p>
      </div>

      <div className="flex flex-col gap-1.5 md:gap-2">
        {t.faq.map((item, i) => (
          <div
            key={item.q}
            className={`rounded-card border transition-colors duration-300 ${
              open === i ? 'bg-white text-black border-white' : 'bg-white/[0.045] border-white/10'
            }`}
            style={reveal.getAnimStyle(i + 1)}
          >
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="w-full text-left p-5 md:p-6 flex items-center justify-between gap-4"
            >
              <span className="text-base md:text-lg font-semibold leading-snug tracking-[-0.01em]">{item.q}</span>
              <span className={`text-xl font-light shrink-0 ${open === i ? 'text-black/60' : 'text-teal'}`}>
                {open === i ? '−' : '+'}
              </span>
            </button>
            {open === i && (
              <p className="px-5 md:px-6 pb-5 md:pb-6 text-sm md:text-base font-medium leading-6 md:leading-7 text-black/70 max-w-[72ch]">
                {item.a}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
