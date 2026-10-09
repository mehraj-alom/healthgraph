import { copy, useLocale } from './i18n';

export default function Footer() {
  const { locale } = useLocale();
  const t = copy[locale];
  return (
    <footer className="w-full px-3 md:px-5 pb-6 md:pb-8 pt-1.5 md:pt-2 bg-stage">
      <div className="rounded-card bg-white/[0.045] border border-white/10 p-5 md:p-8 flex flex-col md:flex-row gap-5 md:items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="bg-white rounded-lg px-2 py-1.5 flex items-center">
            <img src="/logo.png" alt="HealthGraph" className="h-5 w-auto" />
          </span>
          <div>
            <p className="text-ink text-sm font-semibold leading-tight">HealthGraph</p>
            <p className="text-fog text-xs">© 2026 {t.rights}</p>
          </div>
        </div>
        <div className="max-w-xl flex flex-col gap-2">
          <p className="text-fog text-xs leading-5">{t.footerNote}</p>
          <p className="text-white/40 text-xs leading-5">{t.privacyNote}</p>
        </div>
        <div className="flex gap-5 text-xs font-medium">
          <a href="#early-access" className="text-ink hover:text-teal transition-colors duration-200">{t.navCta}</a>
          <a href="#features" className="text-fog hover:text-ink transition-colors duration-200">{t.navLinks[1]}</a>
          <a href="/wissen/" className="text-fog hover:text-ink transition-colors duration-200">
            {locale === 'de' ? 'Wissen' : 'Guides'}
          </a>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-medium">
          <a href="/wissen/influenza-grippewelle-impfung-grippesaison-2026.html" className="text-white/40 hover:text-ink transition-colors duration-200">Influenza &amp; Impfung</a>
          <a href="/wissen/lungenpest-sibirien-russland-pestausbruch-einordnung.html" className="text-white/40 hover:text-ink transition-colors duration-200">Sibirien &amp; Lungenpest</a>
          <a href="/wissen/oelde-magen-darm-imbiss-infekt-norovirus.html" className="text-white/40 hover:text-ink transition-colors duration-200">Oelde Magen-Darm</a>
          <a href="/wissen/laura-wontorra-schwanger-baby-riccardo-basile.html" className="text-white/40 hover:text-ink transition-colors duration-200">Laura Wontorra</a>
          <a href="/wissen/daniel-donskoy-inas-nacht-meine-superkraft.html" className="text-white/40 hover:text-ink transition-colors duration-200">Daniel Donskoy</a>
        </div>
      </div>
    </footer>
  );
}
