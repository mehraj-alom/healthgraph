import { useEffect, useState } from 'react';
import { copy, useLocale, type Locale } from './i18n';

const ANCHORS = ['home', 'features', 'capabilities', 'app', 'why', 'pricing', 'faq'] as const;

export default function Navbar() {
  const { locale, setLocale } = useLocale();
  const t = copy[locale];
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const toggleLocale = () => setLocale((locale === 'de' ? 'en' : 'de') as Locale);

  return (
    <>
      <header className="liquid-glass-dark fixed top-0 left-0 right-0 z-50 backdrop-blur-xl supports-[backdrop-filter]:bg-stage/60 [backdrop-filter:saturate(1.8)_blur(24px)]">
        <div className="flex items-center justify-between h-14 md:h-12 px-4 md:px-6">
          <a href="#home" className="flex items-center gap-2.5 shrink-0">
            <span className="bg-white rounded-lg px-2 py-1.5 flex items-center">
              <img src="/logo.png" alt="HealthGraph" className="h-4 md:h-4 w-auto" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink leading-none">
              HealthGraph
            </span>
          </a>

          <nav className="hidden lg:flex items-center gap-7" aria-label="Primary">
            {t.navLinks.map((label, i) => (
              <a
                key={label}
                href={`#${ANCHORS[i]}`}
                className="text-xs font-medium text-white/75 hover:text-ink transition-colors duration-200"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-2.5">
            <button
              onClick={toggleLocale}
              className="px-3.5 py-1.5 rounded-full border border-white/20 text-xs font-semibold text-white/85 hover:border-white/40 hover:text-ink transition-colors duration-200"
              aria-label="Switch language"
            >
              {locale === 'de' ? 'EN' : 'DE'}
            </button>
            <a
              href="#early-access"
              className="px-4 py-1.5 rounded-full bg-white text-black text-xs font-semibold transition-all duration-200 hover:bg-white/90 active:scale-[0.97]"
            >
              {t.navCta}
            </a>
          </div>

          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={toggleLocale}
              className="px-3 py-1.5 rounded-full border border-white/20 text-xs font-semibold text-white/85"
              aria-label="Switch language"
            >
              {locale === 'de' ? 'EN' : 'DE'}
            </button>
            <button
              className="w-10 h-10 flex items-center justify-center relative"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
            >
              <span className={`absolute h-0.5 w-6 bg-ink rounded-full transition-all duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] ${open ? 'rotate-45 translate-y-0' : '-translate-y-2'}`} />
              <span className={`absolute h-0.5 w-6 bg-ink rounded-full transition-all duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] ${open ? 'opacity-0 scale-x-0' : 'opacity-100 scale-x-100'}`} />
              <span className={`absolute h-0.5 w-6 bg-ink rounded-full transition-all duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] ${open ? '-rotate-45 translate-y-0' : 'translate-y-2'}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      <div className={`md:hidden fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-500 ${open ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setOpen(false)}
        />
        <div className={`absolute top-0 right-0 h-full w-[85%] max-w-sm bg-panel border-l border-white/10 shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.76,0,0.24,1)] ${open ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex flex-col justify-center h-full px-8 gap-1">
            {t.navLinks.map((label, i) => (
              <a
                key={label}
                href={`#${ANCHORS[i]}`}
                onClick={() => setOpen(false)}
                className={`text-3xl font-semibold tracking-[-0.01em] text-ink hover:text-teal transition-all duration-500 ease-[cubic-bezier(0.76,0,0.24,1)] ${open ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
                style={{ transitionDelay: open ? `${100 + i * 60}ms` : '0ms' }}
              >
                {label}
              </a>
            ))}
            <div
              className={`mt-8 pt-8 border-t border-white/10 transition-all duration-500 ${open ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
              style={{ transitionDelay: open ? '450ms' : '0ms' }}
            >
              <a
                href="#early-access"
                onClick={() => setOpen(false)}
                className="block text-center w-full px-6 py-4 bg-white rounded-full text-black text-sm font-semibold transition-colors duration-200"
              >
                {t.navCta}
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
