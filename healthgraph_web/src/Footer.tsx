import { copy, useLocale } from './i18n';

export default function Footer() {
  const { locale } = useLocale();
  const t = copy[locale];

  return (
    <footer className="w-full px-3 md:px-5 pb-6 md:pb-8 bg-stage">
      <div className="rounded-card lg-card p-5 md:p-8 flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="bg-white rounded-lg px-2 py-1.5 flex items-center">
            <img src="/logo.png" alt="HealthGraph" className="h-4 w-auto" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">HealthGraph</span>
        </div>
        <p className="text-[11px] md:text-xs font-medium text-fog max-w-[80ch]">{t.footerNote}</p>
        <p className="text-[11px] md:text-xs font-medium text-fog">{t.privacyNote}</p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] md:text-xs font-medium" aria-label="SEO">
          <a href="#queries" className="text-fog hover:text-teal">100+ answers</a>
          <a href="/sitemap.xml" className="text-fog hover:text-teal">Sitemap</a>
          <a href="/llms.txt" className="text-fog hover:text-teal">llms.txt</a>
          <a href="/queries/" className="text-fog hover:text-teal">All queries</a>
        </nav>
        <p className="text-[11px] md:text-xs font-medium text-fog">
          © {new Date().getFullYear()} HealthGraph. {t.rights}
        </p>
      </div>
    </footer>
  );
}
