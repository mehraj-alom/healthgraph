import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale, videos, type VideoItem } from './i18n';

function VideoCard({ v, style }: { v: VideoItem; style: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="rounded-card lg-card p-5 md:p-6 flex flex-col gap-2"
      style={style}
    >
      <div className="rounded-card bg-black/40 border border-white/10 aspect-video flex items-center justify-center overflow-hidden relative">
        {!failed ? (
          <video
            className="w-full h-full object-cover"
            controls
            preload="none"
            poster={v.poster}
            onError={() => setFailed(true)}
          >
            <source src={v.file} type="video/mp4" onError={() => setFailed(true)} />
          </video>
        ) : null}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(80%_80%_at_50%_20%,rgba(79,209,197,0.25),transparent_70%)]">
            <span aria-hidden className="w-12 h-12 rounded-full lg-chip flex items-center justify-center text-lg">▶</span>
            <span className="text-xs font-semibold tracking-[0.15em] uppercase text-fog">Video folgt · Coming soon</span>
          </div>
        )}
      </div>
      <h3 className="text-base md:text-lg font-semibold text-ink mt-1">{v.title}</h3>
      <p className="text-xs md:text-sm font-medium text-fog">{v.caption}</p>
    </div>
  );
}

export default function Videos() {
  const { locale } = useLocale();
  const t = copy[locale];
  const items = videos[locale];
  const reveal = useStaggeredReveal(3);

  return (
    <section
      id="videos"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card lg-card p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.videosTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.videosSub}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        {items.map((v, i) => (
          <VideoCard key={v.file} v={v} style={reveal.getAnimStyle(i + 1)} />
        ))}
      </div>
    </section>
  );
}
