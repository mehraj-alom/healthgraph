import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function Gallery() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(5);

  return (
    <section
      id="features"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.galleryTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2 max-w-[72ch]">{t.gallerySub}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 md:gap-2">
        {t.features.map((f, i) => (
          <div
            key={f.name}
            className={`rounded-card border p-5 md:p-6 flex flex-col gap-2 min-h-[140px] ${
              f.active ? 'bg-white text-black border-white' : 'bg-white/[0.045] border-white/10'
            }`}
            style={reveal.getAnimStyle(i + 1)}
          >
            {f.num && (
              <span className={`text-xs font-semibold tracking-[0.2em] ${f.active ? 'text-black/50' : 'text-teal'}`}>
                {f.num}
              </span>
            )}
            <span className={`text-sm md:text-base font-semibold whitespace-pre-line ${f.active ? '' : 'text-ink'}`}>
              {f.name}
            </span>
            {i === 0 && (
              <span className="text-[11px] font-semibold tracking-[0.15em] uppercase opacity-60 whitespace-pre-line">
                {t.galleryMakeover}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
