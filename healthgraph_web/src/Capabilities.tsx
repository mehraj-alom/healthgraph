import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale, type CapabilityGroup } from './i18n';

const NUMERALS = ['01', '02', '03', '04'];

function StoryPanel({
  group,
  numeral,
  flip,
  animStyle,
}: {
  group: CapabilityGroup;
  numeral: string;
  flip: boolean;
  animStyle: React.CSSProperties;
}) {
  const reveal = useStaggeredReveal(1 + group.items.length);
  const [open, setOpen] = useState<number | null>(null);

  const visual = (
    <div className="relative flex flex-col justify-center items-start p-5 md:p-10 min-h-[220px] md:min-h-[320px] overflow-hidden">
      <span
        aria-hidden
        className="font-semibold leading-none tracking-[-0.04em] text-white/[0.07] select-none text-[clamp(6rem,18vw,13rem)]"
      >
        {numeral}
      </span>
      <span className="mt-2 text-xs md:text-sm font-semibold tracking-[0.25em] uppercase text-teal">
        {group.title}
      </span>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${
          flip
            ? 'bg-[radial-gradient(80%_80%_at_20%_50%,rgba(59,91,255,0.20),transparent_70%)]'
            : 'bg-[radial-gradient(80%_80%_at_80%_50%,rgba(59,91,255,0.20),transparent_70%)]'
        }`}
      />
    </div>
  );

  const story = (
    <div className="flex flex-col gap-2 p-5 md:p-10">
      <h3 className="text-2xl md:text-4xl font-semibold tracking-[-0.02em] text-ink" style={reveal.getAnimStyle(0)}>
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

  return (
    <div
      ref={reveal.containerRef as React.Ref<HTMLDivElement>}
      style={animStyle}
      className="rounded-card lg-card overflow-hidden hairline-cobalt"
    >
      <div className="grid grid-cols-1 md:grid-cols-2">
        {flip ? (
          <>
            <div className="order-2 md:order-1">{story}</div>
            <div className="order-1 md:order-2 border-b md:border-b-0 md:border-l border-white/10">{visual}</div>
          </>
        ) : (
          <>
            <div className="border-b md:border-b-0 md:border-r border-white/10">{visual}</div>
            <div>{story}</div>
          </>
        )}
      </div>
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
        className="rounded-card lg-card p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {t.capabilitiesTitle}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">{t.capabilitiesSub}</p>
      </div>

      <div className="flex flex-col gap-1.5 md:gap-2">
        {t.capabilities.map((group, gi) => (
          <StoryPanel
            key={group.title}
            group={group}
            numeral={NUMERALS[gi] ?? String(gi + 1).padStart(2, '0')}
            flip={gi % 2 === 1}
            animStyle={reveal.getAnimStyle(gi + 1)}
          />
        ))}
      </div>
    </section>
  );
}
