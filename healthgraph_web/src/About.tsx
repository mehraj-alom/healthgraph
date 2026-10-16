import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function About() {
  const { locale } = useLocale();
  const t = copy[locale].about;
  const reveal = useStaggeredReveal(3);
  const [imgOk, setImgOk] = useState(true);

  return (
    <section
      id="about"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-8 flex flex-col gap-3"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.title}
        </h2>
        <p className="text-sm md:text-base font-medium text-ink max-w-[72ch]">{t.lead}</p>
        <p className="text-xs md:text-sm font-medium leading-6 text-fog max-w-[72ch]">{t.journey}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        <figure
          className="rounded-card lg-card overflow-hidden m-0"
          style={reveal.getAnimStyle(1)}
        >
          {imgOk ? (
            <img
              src="/builders.svg"
              alt={t.photoAlt}
              className="w-full h-auto block aspect-[8/5] object-cover"
              loading="lazy"
              onError={() => setImgOk(false)}
            />
          ) : (
            <div className="aspect-[8/5] flex items-center justify-center gap-3 bg-[radial-gradient(80%_80%_at_50%_20%,rgba(79,209,197,0.25),transparent_70%)]">
              <span className="w-14 h-14 rounded-full lg-chip flex items-center justify-center text-lg font-semibold">A</span>
              <span className="w-14 h-14 rounded-full lg-chip flex items-center justify-center text-lg font-semibold">B</span>
            </div>
          )}
          <figcaption className="px-5 md:px-6 py-3 text-[11px] md:text-xs font-medium text-fog">
            {t.photoAlt}
          </figcaption>
        </figure>
        <div
          className="rounded-card lg-card p-5 md:p-8 flex flex-col gap-3"
          style={reveal.getAnimStyle(2)}
        >
          <p className="text-sm md:text-base font-medium text-fog max-w-[72ch]">{t.problem1}</p>
          <p className="text-lg md:text-xl font-semibold text-ink">{t.problem2}</p>
          <p className="text-sm md:text-base font-medium text-fog max-w-[72ch]">{t.vision1}</p>
          <p className="text-sm md:text-base font-medium text-ink max-w-[72ch]">{t.vision2}</p>
          <blockquote className="border-l-2 border-teal pl-4 text-sm md:text-base font-semibold text-ink">
            “{t.quote}”
          </blockquote>
        </div>
      </div>
    </section>
  );
}
