import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Hero() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(4);

  return (
    <section
      id="home"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col items-start pt-20 md:pt-24 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-10 w-full"
        style={reveal.getAnimStyle(0)}
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {t.heroBars.map((b) => (
            <span
              key={b}
              className="lg-chip px-3 py-1.5 text-xs font-semibold text-white/85"
            >
              {b}
            </span>
          ))}
        </div>
        <p className="text-xs md:text-sm font-semibold tracking-[0.15em] uppercase text-teal">
          {t.heroKicker}
        </p>
        <h1 className="text-[clamp(2.8rem,8vw,6.5rem)] font-semibold leading-[1.0] tracking-[-0.03em] text-ink mt-2">
          {t.heroTitleA}
          <br />
          <span className="teal-algae-text">{t.heroTitleB}</span>
        </h1>
        <p className="text-sm md:text-base font-medium leading-6 md:leading-7 text-fog mt-4 max-w-[68ch]">
          {t.heroSub}
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <a
            href="#early-access"
            className="inline-flex items-center justify-center rounded-full bg-white text-black text-sm font-semibold px-6 py-3"
          >
            {t.navCta}
          </a>
          <a
            href="#features"
            className="inline-flex items-center justify-center rounded-full border border-white/20 text-sm font-semibold px-6 py-3 text-ink"
          >
            {t.galleryCta}
          </a>
        </div>
      </div>
    </section>
  );
}
