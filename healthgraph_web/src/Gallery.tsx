import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

const BG = '/bg-pulse.svg';

export default function Gallery() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(4);

  return (
    <section
      id="features"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        {/* Every signal, over the pulse art */}
        <div
          style={reveal.getAnimStyle(0)}
          className="relative rounded-card overflow-hidden min-h-[220px] md:min-h-[300px] flex flex-col justify-between p-5 md:p-7"
        >
          <div
            className="absolute inset-0"
            aria-hidden
            style={{ backgroundImage: `url(${BG})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stage/85 via-stage/35 to-stage/45" aria-hidden />
          <h2 className="relative z-10 text-ink text-2xl md:text-4xl font-semibold tracking-[-0.02em]">
            {t.galleryTitle}
          </h2>
          <p className="relative z-10 text-fog text-xs md:text-sm font-medium">
            {t.gallerySub}
          </p>
        </div>

        {/* Pulse check display type */}
        <div
          style={reveal.getAnimStyle(1)}
          className="rounded-card bg-white/[0.045] border border-white/10 min-h-[220px] md:min-h-[300px] flex items-start p-5 md:p-7"
        >
          <h2 className="text-ink text-[clamp(3rem,7vw,5.5rem)] font-semibold leading-[0.9] tracking-[-0.03em] whitespace-pre-line">
            {t.galleryMakeover}
          </h2>
        </div>

        {/* How it works */}
        <div
          style={reveal.getAnimStyle(2)}
          className="rounded-card bg-white/[0.045] border border-white/10 min-h-[160px] md:min-h-[220px] flex flex-col justify-between gap-6 p-5 md:p-7"
        >
          <p className="text-ink text-sm md:text-base font-semibold leading-5 md:leading-6 max-w-[36ch]">
            {locale === 'de'
              ? <>Halte dein Handy ans Licht,<br />der Puls misst sich von selbst.</>
              : <>Hold your phone to the light,<br />your pulse reads itself.</>}
          </p>
          <a
            href="#app"
            className="self-start px-5 py-3 md:px-6 md:py-3.5 bg-white rounded-full text-black text-sm font-semibold transition-all duration-200 hover:bg-white/90 active:scale-[0.97]"
          >
            {t.galleryCta}
          </a>
        </div>

        {/* The four core features */}
        <div
          style={reveal.getAnimStyle(3)}
          className="rounded-card bg-white/[0.045] border border-white/10 p-2 md:p-3 grid grid-cols-2 md:grid-cols-4 gap-1.5 md:gap-2"
        >
          {t.features.map((svc) => (
            <div
              key={svc.name}
              className={`rounded-[16px] p-3 md:p-5 flex flex-col justify-between min-h-[120px] md:min-h-[180px] ${svc.active ? 'bg-white/95' : 'bg-white/[0.06]'}`}
            >
              <h3 className={`text-lg md:text-2xl font-semibold leading-[1.05] tracking-[-0.02em] whitespace-pre-line ${svc.active ? 'text-black' : 'text-ink'}`}>
                {svc.name}
              </h3>
              {svc.num && (
                <span className={`self-end w-7 h-7 md:w-10 md:h-10 rounded-full border flex items-center justify-center text-xs font-semibold tabular-nums ${svc.active ? 'border-black/30 text-black' : 'border-white/25 text-ink/80'}`}>
                  {svc.num}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
