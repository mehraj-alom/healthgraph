import { useStaggeredReveal } from './hooks';
import { useLocale } from './i18n';

const ARTICLES = [
  {
    href: '/wissen/influenza-grippewelle-impfung-grippesaison-2026.html',
    vol: { de: '10K+ Suchen · Impfung · Grippesaison', en: '10K+ searches · Flu shot · Season' },
    title: {
      de: 'Influenza 2026: Grippewelle, Impfung & Grippesaison',
      en: 'Influenza 2026: wave, shot & season',
    },
    desc: {
      de: 'Wer hat Anspruch? Wann impfen? STIKO, Timing, 5-Tage-Plan + Checkliste.',
      en: 'Who qualifies? When to get it? STIKO, timing, 5-day plan + checklist.',
    },
  },
  {
    href: '/wissen/lungenpest-sibirien-russland-pestausbruch-einordnung.html',
    vol: { de: '100K+ Suchen · Sibirien · Lungenpest Russland', en: '100K+ searches · Siberia · Plague' },
    title: {
      de: 'Sibirien & Lungenpest: was wirklich bekannt ist',
      en: 'Siberia & plague: what is actually known',
    },
    desc: {
      de: 'Irkutsk, WHO, 200 in Quarantäne, Risiko für Europa? Ruhig eingeordnet.',
      en: 'Irkutsk, WHO, 200 quarantined, risk for Europe? Calmly explained.',
    },
  },
  {
    href: '/wissen/oelde-magen-darm-imbiss-infekt-norovirus.html',
    vol: { de: '5K+ Suchen · Oelde · Magen-Darm', en: '5K+ searches · Oelde · Stomach bug' },
    title: {
      de: 'Oelde: 51 Magen-Darm-Fälle nach Imbissbesuch',
      en: 'Oelde: 51 stomach cases after snack bar visit',
    },
    desc: {
      de: 'Was das Gesundheitsamt sagt, 5-Schritte-Plan bei Symptomen.',
      en: 'What health officials say, 5-step plan if symptomatic.',
    },
  },
];

export default function Wissen() {
  const { locale } = useLocale();
  const reveal = useStaggeredReveal(ARTICLES.length + 1);
  return (
    <section
      id="wissen"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 glow-cobalt hairline-cobalt"
        style={reveal.getAnimStyle(0)}
      >
        <p className="text-xs md:text-sm font-semibold tracking-[0.2em] text-teal">
          {locale === 'de' ? 'WISSEN · GERADE GESUCHT IN DEUTSCHLAND' : 'GUIDES · TRENDING IN GERMANY NOW'}
        </p>
        <h2 className="mt-2 text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {locale === 'de' ? 'Wonach Deutschland gerade sucht.' : 'What Germany is searching right now.'}
        </h2>
        <p className="mt-2 text-xs md:text-sm font-medium text-fog max-w-[70ch]">
          {locale === 'de'
            ? 'Antworten zu dem, was Deutschland heute sucht, mit RKI und STIKO Stand 09.10.2026. Checkliste als PDF auf Wunsch.'
            : 'Answers to what Germany searches today, with RKI and STIKO sources. Checklist PDF on request.'}
        </p>
        <div className="mt-3">
          <a
            href="/wissen/"
            className="inline-flex items-center justify-center rounded-full text-sm font-semibold px-6 py-3 w-fit btn-cobalt"
          >
            {locale === 'de' ? 'Alle 3 Guides ansehen' : 'See all 3 guides'}
          </a>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 md:gap-2">
        {ARTICLES.map((a, i) => (
          <a
            key={a.href}
            href={a.href}
            style={reveal.getAnimStyle(i + 1)}
            className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-7 flex flex-col gap-2 hairline-cobalt hover:border-cobalt/60 transition-colors duration-200"
          >
            <span className="text-[11px] md:text-xs font-semibold tracking-[0.14em] text-teal uppercase">
              {a.vol[locale]}
            </span>
            <span className="text-xl md:text-2xl font-semibold tracking-[-0.01em] text-ink leading-snug">
              {a.title[locale]}
            </span>
            <span className="text-sm font-medium leading-6 text-fog">{a.desc[locale]}</span>
            <span className="mt-1 text-sm font-semibold text-ink">
              {locale === 'de' ? 'Guide lesen →' : 'Read guide →'}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
