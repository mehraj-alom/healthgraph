import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

const BG = '/bg-graph.svg';

export default function Hero() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(2);

  return (
    <section
      id="home"
      ref={reveal.containerRef}
      className="relative min-h-[100dvh] w-full overflow-hidden bg-stage flex items-center"
    >
      {/* The product visual: one health graph, full-bleed */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{ backgroundImage: `url(${BG})`, backgroundSize: 'cover', backgroundPosition: 'center 40%' }}
      />
      {/* Scrims so the type stays readable and the section melts into the next */}
      <div className="absolute inset-0 bg-gradient-to-r from-stage via-stage/55 to-stage/10" aria-hidden />
      <div className="absolute inset-0 glow-cobalt" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-stage to-transparent" aria-hidden />

      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-24 md:pt-28 pb-20 md:pb-28">
        <div>
          <p
            style={reveal.getAnimStyle(0)}
            className="text-fog text-sm md:text-base font-semibold leading-6 max-w-[44ch]"
          >
            {t.heroKicker}
          </p>
          <h1
            style={reveal.getAnimStyle(0)}
            className="mt-5 text-ink text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.92] tracking-[-0.03em]"
          >
            {t.heroTitleA}<br />{t.heroTitleB}
          </h1>
          <p
            style={reveal.getAnimStyle(1)}
            className="mt-6 text-fog text-base md:text-lg font-medium leading-7 max-w-[44ch]"
          >
            {t.heroSub}
          </p>
          <div style={reveal.getAnimStyle(1)} className="mt-8 flex items-center gap-4">
            <a
              href="#early-access"
              className="px-7 py-3.5 rounded-full text-sm font-semibold btn-cobalt active:scale-[0.98]"
            >
              {t.navCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
