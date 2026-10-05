import { useEffect, useRef, useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale, videos } from './i18n';

export default function Videos() {
  const { locale } = useLocale();
  const t = copy[locale];
  const items = videos[locale];
  const reveal = useStaggeredReveal(3);
  const [active, setActive] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Switching language returns to the poster state of the new language.
  useEffect(() => setActive(null), [locale]);

  // A click is a user gesture, so play-with-sound is allowed.
  useEffect(() => {
    videoRef.current?.play().catch(() => { /* user can press play */ });
  }, [active]);

  return (
    <section
      id="videos"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.videosTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.videosSub}</p>
      </div>

      <div className="flex flex-col md:flex-row items-stretch md:items-start justify-center gap-1.5 md:gap-4">
        {items.map((v, i) => (
          <div
            key={v.file}
            style={reveal.getAnimStyle(i + 1)}
            className="w-full md:w-[320px] shrink-0 rounded-card bg-white/[0.045] border border-white/10 p-3 md:p-4 flex flex-col gap-3"
          >
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[300px] md:max-w-none overflow-hidden rounded-xl bg-black">
              {active === i ? (
                <video
                  ref={videoRef}
                  src={v.file}
                  poster={v.poster}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className="absolute inset-0 group"
                  aria-label={`Play: ${v.title}`}
                >
                  <img
                    src={v.poster}
                    alt={v.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center shadow-xl transition-transform duration-300 group-hover:scale-110">
                      <svg viewBox="0 0 24 24" className="w-6 h-6 ml-1" fill="#08090D" aria-hidden>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </span>
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <h4 className="text-base md:text-lg font-semibold text-ink leading-tight tracking-[-0.01em]">{v.title}</h4>
              <p className="text-fog text-xs md:text-sm font-medium leading-5">{v.caption}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
