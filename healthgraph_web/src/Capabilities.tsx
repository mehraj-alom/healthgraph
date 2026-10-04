import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale, type CapabilityGroup } from './i18n';

function GroupCard({ group, animStyle }: { group: CapabilityGroup; animStyle: React.CSSProperties }) {
  const reveal = useStaggeredReveal(1 + group.items.length);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div
      ref={reveal.containerRef as React.Ref<HTMLDivElement>}
      style={animStyle}
      className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-7 flex flex-col gap-4 hairline-cobalt"
    >
      <h3
        className="text-xl md:text-2xl font-semibold tracking-[-0.01em] text-ink"
        style={reveal.getAnimStyle(0)}
      >
        {group.title}
      </h3>
      <ul className="flex flex-col divide-y divide-white/[0.07]">
        {group.items.map((item, i) => (
          <li key={item.name} style={reveal.getAnimStyle(i + 1)}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="w-full text-left py-3.5 first:pt-0 last:pb-0 flex flex-col gap-1 group/row"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm md:text-base font-semibold text-ink">{item.name}</span>
                <span
                  aria-hidden
                  className={`text-lg font-light shrink-0 transition-transform duration-300 ${
                    open === i ? 'text-cobalt rotate-45' : 'text-fog group-hover/row:text-cobalt'
                  }`}
                >
                  +
                </span>
              </span>
              <span className="text-xs md:text-sm font-medium leading-5 text-fog">{item.desc}</span>
              <span
                className={`grid transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  open === i ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <span className="overflow-hidden">
                  <span
                    className={`block text-xs md:text-sm font-medium leading-5 md:leading-6 border-l-2 border-cobalt/60 pl-3 ${
                      open === i ? 'text-ink' : 'text-fog'
                    }`}
                  >
                    {item.detail}
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Capabilities() {
  const { locale } = useLocale();
  const t = copy[locale];
  const reveal = useStaggeredReveal(5);

  return (
    <section
      id="capabilities"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.capabilitiesTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.capabilitiesSub}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        {t.capabilities.map((group, gi) => (
          <GroupCard key={group.title} group={group} animStyle={reveal.getAnimStyle(gi + 1)} />
        ))}
      </div>
    </section>
  );
}
