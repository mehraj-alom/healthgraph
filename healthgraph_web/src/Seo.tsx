import { useEffect } from 'react';
import { useLocale } from './i18n';

const META: Record<string, { title: string; desc: string }> = {
  de: {
    title: 'HealthGraph – Gesundheit verbunden | Puls messen, Schlaf, Medikamente',
    desc: 'Puls per Kamera messen, Schlaf, Medikamente, Ernährung, Zyklus und Dokumente in einem Graph. Kostenlos starten. DSGVO-konform.',
  },
  en: {
    title: 'HealthGraph – Health, connected | Camera pulse, sleep, meds, meals',
    desc: 'Check pulse with your camera. Log meds, meals, sleep and cycle. One graph holds it all, on your phone. Free to start.',
  },
};

/** Keeps <html lang>, title and meta description in sync with the DE/EN toggle (GEO/SEO). */
export default function Seo() {
  const { locale } = useLocale();
  useEffect(() => {
    const m = META[locale];
    document.documentElement.lang = locale === 'de' ? 'de' : 'en';
    document.title = m.title;
    const el = document.querySelector('meta[name="description"]');
    if (el) el.setAttribute('content', m.desc);
  }, [locale]);
  return null;
}
