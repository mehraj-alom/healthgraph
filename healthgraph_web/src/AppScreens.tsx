import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

const TIMELINE = [
  { t: '07:12', d: 'Voice check-in: schlecht geschlafen, Schulter zieht.' },
  { t: '08:05', d: 'Barcode: Haferflocken · 350 kcal.' },
  { t: '13:40', d: 'Mittagsdosis genommen · Family Watch ok.' },
];

const BARS = [38, 52, 44, 66, 58, 74, 62];

export default function AppScreens() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(2);

  return (
    <section
      id="app"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white text-black border border-white p-5 md:p-10 flex flex-col gap-3"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em]">
          {t.screensTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-black/60">{t.screensSub}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          <div
            className="rounded-card border border-black/10 bg-black/[0.03] p-5 min-h-[190px] flex flex-col gap-2"
            style={reveal.getAnimStyle(1)}
          >
            <span className="text-xs font-semibold tracking-[0.2em] text-black/40">01 · Timeline</span>
            {TIMELINE.map((r) => (
              <div key={r.t} className="flex gap-2 items-baseline">
                <span className="text-xs font-semibold text-teal-dark">{r.t}</span>
                <span className="text-xs font-medium text-black/70">{r.d}</span>
              </div>
            ))}
          </div>
          <div
            className="rounded-card border border-black/10 bg-black/[0.03] p-5 min-h-[190px] flex flex-col gap-2"
            style={reveal.getAnimStyle(1)}
          >
            <span className="text-xs font-semibold tracking-[0.2em] text-black/40">02 · Graph</span>
            <div className="flex items-end gap-1.5 h-24 mt-1" aria-hidden>
              {BARS.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full bg-[#0B4A3F]"
                  style={{ height: `${h}%`, opacity: 0.35 + (i / BARS.length) * 0.65 }}
                />
              ))}
            </div>
            <span className="text-xs font-medium text-black/70">Nächte erklären Morgen · 7-Tage-Trend</span>
          </div>
          <div
            className="rounded-card border border-black/10 bg-black/[0.03] p-5 min-h-[190px] flex flex-col gap-2"
            style={reveal.getAnimStyle(1)}
          >
            <span className="text-xs font-semibold tracking-[0.2em] text-black/40">03 · Check-in</span>
            {['Schlaf ✓', 'Medis ✓', 'Stimmung ○'].map((c) => (
              <span key={c} className="text-xs font-medium text-black/70 rounded-full border border-black/10 px-3 py-1.5 w-fit">
                {c}
              </span>
            ))}
            <span className="text-xs font-medium text-black/50">60 Sekunden · Stimme oder Tipp</span>
          </div>
        </div>
      </div>
    </section>
  );
}
