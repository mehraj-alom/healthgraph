import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Compare() {
  const t = copy[useLocale().locale];
  const reveal = useStaggeredReveal(3);

  return (
    <section
      id="why"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.compareTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.compareSub}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        <div
          className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-7 flex flex-col gap-4"
          style={reveal.getAnimStyle(1)}
        >
          <h3 className="text-xl md:text-2xl font-semibold tracking-[-0.01em] text-fog">
            10
          </h3>
          <ul className="flex flex-col divide-y divide-white/[0.07]">
            {t.compareApps.map((app) => (
              <li key={app} className="py-2.5 first:pt-0 last:pb-0 flex flex-col">
                <span className="text-sm md:text-base font-semibold text-fog line-through decoration-white/30">{app}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs md:text-sm font-medium leading-5 text-fog">{t.compareLeft}</p>
        </div>

        <div
          className="rounded-card bg-white text-black border border-white p-5 md:p-7 flex flex-col gap-4 justify-center"
          style={reveal.getAnimStyle(2)}
        >
          <h3 className="text-xl md:text-2xl font-semibold tracking-[-0.01em]">HealthGraph</h3>
          <p className="text-sm md:text-base font-medium leading-6 text-black/70">
            {t.compareRight}
          </p>
          <p className="text-lg md:text-xl font-semibold leading-snug tracking-[-0.01em]">
            {t.comparePunch}
          </p>
          <a
            href="#early-access"
            className="inline-flex items-center justify-center rounded-full bg-black text-white text-sm font-semibold px-6 py-3 w-fit"
          >
            {t.compareCta}
          </a>
        </div>
      </div>
    </section>
  );
}
