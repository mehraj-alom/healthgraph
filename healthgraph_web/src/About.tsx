import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function About() {
  const { locale } = useLocale();
  const t = copy[locale].about;
  const reveal = useStaggeredReveal(2);

  return (
    <section
      id="about"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 overflow-hidden"
        style={reveal.getAnimStyle(0)}
      >
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* The photo */}
          <div className="relative min-h-[280px] md:min-h-[560px]">
            <img
              src="/founders.jpg"
              alt={t.photoAlt}
              width={1200}
              height={900}
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* hairline where the photo meets the text column */}
            <div className="absolute inset-y-0 right-0 w-px bg-white/10 hidden md:block" aria-hidden />
          </div>

          {/* The story */}
          <div className="p-6 md:p-10 flex flex-col gap-5 md:gap-6">
            <h2 className="text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
              {t.title}
            </h2>

            <p className="text-base md:text-lg font-medium leading-7 md:leading-8 text-fog max-w-[52ch]">
              {t.lead}
            </p>

            <p className="text-sm md:text-base font-medium leading-6 md:leading-7 text-fog max-w-[58ch]">
              {t.journey}
            </p>

            <p className="text-sm md:text-base font-medium leading-6 md:leading-7 text-fog max-w-[58ch]">
              {t.problem1}{' '}
              <span className="text-ink font-semibold">{t.problem2}</span>
            </p>

            <p className="text-sm md:text-base font-medium leading-6 md:leading-7 text-fog max-w-[58ch]">
              {t.vision1}{' '}
              <span className="text-ink font-semibold">{t.vision2}</span>
            </p>

            <blockquote className="border-t border-white/10 pt-5 md:pt-6">
              <p className="text-xl md:text-2xl font-semibold leading-snug tracking-[-0.01em] text-ink max-w-[36ch]">
                {t.quote}
              </p>
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}
