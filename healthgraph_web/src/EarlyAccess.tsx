import { useState } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

export default function EarlyAccess() {
  const { locale } = useLocale();
  const t = copy[locale].earlyAccess;
  const reveal = useStaggeredReveal(2);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setMsg(t.nameError); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg(t.emailError); return; }
    if (!city.trim()) { setMsg(t.cityError); return; }
    setStatus('sending');
    setMsg('');
    try {
      const base = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') ?? '';
      const res = await fetch(`${base}/api/v1/early-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), city: city.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('ok');
    } catch {
      setStatus('err');
      setMsg(t.error);
    }
  };

  return (
    <section
      id="early-access"
      ref={reveal.containerRef as React.Ref<HTMLElement>}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-3 md:pb-5 gap-1.5 md:gap-2 bg-stage"
    >
      <div
        className="rounded-card bg-white text-black border border-white p-5 md:p-10 flex flex-col gap-3"
        style={reveal.getAnimStyle(0)}
      >
        <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em]">
          {t.title}
        </h2>
        <p className="text-xs md:text-sm font-medium text-black/60 max-w-[68ch]">{t.sub}</p>
        {status === 'ok' ? (
          <div className="mt-2">
            <p className="text-lg font-semibold">{t.successTitle}</p>
            <p className="text-sm text-black/60 mt-1">{t.successBody}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t.nameLabel}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-card border border-black/15 px-4 py-3 text-sm outline-none focus:border-black/40"
                autoComplete="name"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t.emailLabel}</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="rounded-card border border-black/15 px-4 py-3 text-sm outline-none focus:border-black/40"
                autoComplete="email"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">{t.cityLabel}</span>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="rounded-card border border-black/15 px-4 py-3 text-sm outline-none focus:border-black/40"
                autoComplete="address-level2"
              />
            </label>
            <div className="md:col-span-3 flex flex-col gap-2">
              {msg && <p className="text-xs font-medium text-red-700">{msg}</p>}
              <p className="text-[11px] text-black/50">{t.helper}</p>
              <button
                type="submit"
                disabled={status === 'sending'}
                className="inline-flex items-center justify-center rounded-full bg-black text-white text-sm font-semibold px-6 py-3 w-fit disabled:opacity-60"
              >
                {status === 'sending' ? t.submitting : t.submit}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
