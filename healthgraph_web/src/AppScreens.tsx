import { useStaggeredReveal } from './hooks';
import PhoneMock from './PhoneMock';
import { copy, useLocale } from './i18n';

export default function AppScreens() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(4);

  const captions =
    locale === 'de'
      ? ['Dial & Kacheln, alles live', 'Sanotts antwortet mit Belegen', 'Kamera-Puls in 60 Sekunden']
      : ['Dial & tiles, everything live', 'Sanotts answers with evidence', 'Camera pulse in 60 seconds'];

  return (
    <section id="app" ref={reveal.containerRef} className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage">
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.screensTitle}
        </h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mt-2">
          <p className="text-xs md:text-sm font-medium text-fog">{t.screensSub}</p>
          <a
            href="#early-access"
            className="px-5 py-2.5 rounded-full bg-white text-black text-xs md:text-sm font-semibold transition-all duration-200 hover:bg-white/90 active:scale-[0.97]"
          >
            {t.navCta}
          </a>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 md:gap-2">
        {(['dashboard', 'chat', 'pulse'] as const).map((s, i) => (
          <div key={s} style={reveal.getAnimStyle(i + 1)}>
            <PhoneMock screen={s} caption={captions[i]} />
          </div>
        ))}
      </div>
    </section>
  );
}
