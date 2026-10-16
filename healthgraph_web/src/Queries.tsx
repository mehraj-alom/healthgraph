import { useEffect } from 'react';
import { QUERIES } from './queries';
import { QUERIES_DE } from './queries_de';
import { useStaggeredReveal } from './hooks';
import { useLocale } from './i18n';

export default function Queries() {
  const { locale } = useLocale();
  const reveal = useStaggeredReveal(3);
  const isDe = locale === 'de';
  const list = isDe ? QUERIES_DE : QUERIES;

  // GEO: FAQPage schema for the visible list so AI search cites us.
  useEffect(() => {
    const id = 'hg-queries-faq';
    document.getElementById(id)?.remove();
    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: list.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
    document.head.appendChild(script);
    return () => { document.getElementById(id)?.remove(); };
  }, [locale]);

  return (
    <section
      id="queries"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card glass liquid-glass p-5 md:p-8"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
          {isDe ? 'Antworten.' : 'Answers.'}
        </h2>
        <p className="text-xs md:text-sm font-medium text-fog mt-2">
          {isDe
            ? `${QUERIES_DE.length} Fragen aus Deutschland: Puls, Schlaf, Medis, Ernährung, Arzt – jede landet hier, beantwortet aus der App.`
            : '100 questions people ask before they switch. Each one lands here, answered from the app itself.'}
        </p>
      </div>

      <div
        className="rounded-card p-5 md:p-8 bg-white/[0.045] border border-white/10"
        style={reveal.getAnimStyle(1)}
      >
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 list-none m-0 p-0">
          {list.map((item) => (
            <li key={item.slug} id={`q-${item.slug}`} className="scroll-mt-20">
              <a href={`#q-${item.slug}`} className="block py-2 group">
                <span className="block text-sm md:text-base font-semibold text-ink group-hover:text-teal transition-colors">
                  {item.q}
                </span>
                <span className="block text-xs md:text-sm font-medium leading-5 text-fog mt-1">
                  {item.a}{' '}
                  <span className="text-teal">{isDe ? 'Siehe #' : 'See #'}{item.section}.</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
