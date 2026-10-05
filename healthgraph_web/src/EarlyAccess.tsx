import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useStaggeredReveal } from './hooks';
import { copy, useLocale } from './i18n';

/**
 * Production waitlist endpoint (FastAPI, early_access_signups table in the
 * healthgraph backend). Submissions are also kept in localStorage under
 * 'hg-early-access' as a local receipt.
 */
const FORM_ENDPOINT = 'https://api.healthgraph.shop/api/v1/early-access';

interface FormValues {
  name: string;
  email: string;
  city: string;
}

type Errors = Partial<Record<keyof FormValues, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: FormValues, msgs: { nameError: string; emailError: string; cityError: string }): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = msgs.nameError;
  if (!EMAIL_RE.test(values.email.trim())) errors.email = msgs.emailError;
  if (!values.city.trim()) errors.city = msgs.cityError;
  return errors;
}

async function submit(values: FormValues): Promise<void> {
  const payload = { name: values.name.trim(), email: values.email.trim(), city: values.city.trim() };
  if (FORM_ENDPOINT) {
    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return;
  }
  try {
    const raw = localStorage.getItem('hg-early-access');
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      list.push({ ...payload, at: new Date().toISOString() });
      localStorage.setItem('hg-early-access', JSON.stringify(list));
    }
  } catch { /* storage unavailable; the UI still confirms intent */ }
}

const inputClass =
  'w-full rounded-xl bg-white/[0.06] border border-white/15 px-4 py-3.5 text-base text-ink ' +
  'placeholder:text-white/35 transition-colors duration-200 ' +
  'hover:border-white/25 focus:border-teal focus:bg-white/[0.08] focus:outline-none';

export default function EarlyAccess() {
  const { locale } = useLocale();
  const t = copy[locale].earlyAccess;
  const reveal = useStaggeredReveal(2);
  const [values, setValues] = useState<FormValues>({ name: '', email: '', city: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const set = (key: keyof FormValues) => (e: ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((err) => ({ ...err, [key]: undefined }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    const nextErrors = validate(values, t);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setStatus('submitting');
    try {
      await submit(values);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const field = (key: keyof FormValues, label: string, type: string, autoComplete: string, error?: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={`ea-${key}`} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={`ea-${key}`}
        name={key}
        type={type}
        value={values[key]}
        onChange={set(key)}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `ea-${key}-error` : undefined}
        className={`${inputClass} ${error ? 'border-[#ff453a] focus:border-[#ff453a]' : ''}`}
      />
      {error && (
        <p id={`ea-${key}-error`} className="text-xs font-medium text-[#ff453a]">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <section
      id="early-access"
      ref={reveal.containerRef}
      className="w-full flex flex-col pt-1.5 md:pt-2 px-3 md:px-5 pb-1.5 md:pb-2 bg-stage"
    >
      <div
        className="rounded-card bg-white/[0.045] border border-white/10 overflow-hidden"
        style={reveal.getAnimStyle(0)}
      >
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Left: the pitch */}
          <div className="p-6 md:p-10 flex flex-col justify-between gap-6 border-b md:border-b-0 md:border-r border-white/10">
            <h2 className="text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
              {t.title}
            </h2>
            <div className="flex flex-col gap-3">
              <p className="text-sm md:text-base font-medium leading-6 text-fog max-w-[38ch]">{t.sub}</p>
              <p className="text-xs font-medium leading-5 text-white/40">{t.helper}</p>
            </div>
          </div>

          {/* Right: the form (or its success state) */}
          <div className="p-6 md:p-10" aria-live="polite">
            {status === 'success' ? (
              <div className="h-full min-h-[260px] flex flex-col items-start justify-center gap-3">
                <span
                  className="w-12 h-12 rounded-full bg-teal/15 border border-teal/40 flex items-center justify-center"
                  aria-hidden
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#4FD1C5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                </span>
                <h3 className="text-2xl md:text-3xl font-semibold tracking-[-0.01em] text-ink">{t.successTitle}</h3>
                <p className="text-sm font-medium leading-6 text-fog max-w-[40ch]">{t.successBody}</p>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                {/* Honeypot: bots fill this, people never see it. */}
                <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {field('name', t.nameLabel, 'text', 'name', errors.name)}
                  {field('city', t.cityLabel, 'text', 'address-level2', errors.city)}
                </div>
                {field('email', t.emailLabel, 'email', 'email', errors.email)}

                {status === 'error' && (
                  <p role="alert" className="text-xs font-medium text-[#ff453a]">
                    {t.error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="w-full sm:w-auto self-start px-8 py-4 rounded-full text-sm font-semibold btn-cobalt disabled:opacity-60 disabled:active:scale-100"
                >
                  {status === 'submitting' ? t.submitting : t.submit}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
