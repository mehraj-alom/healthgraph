import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'de';

const LocaleCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: 'en',
  setLocale: () => {},
});

export const useLocale = () => useContext(LocaleCtx);

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem('hg-locale');
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* ignore */ }
  try {
    // Germany (or German-language browser) sees the German videos + copy.
    if (navigator.language.toLowerCase().startsWith('de')) return 'de';
  } catch { /* ignore */ }
  return 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  useEffect(() => setLocaleState(detectLocale()), []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem('hg-locale', l); } catch { /* ignore */ }
  };
  return <LocaleCtx.Provider value={{ locale, setLocale }}>{children}</LocaleCtx.Provider>;
}

export interface CapabilityGroup {
  title: string;
  items: { name: string; desc: string; detail: string }[];
}

export interface Point {
  name: string;
  desc: string;
}

export interface Tier {
  name: string;
  price: string;
  per: string;
  cta: string;
  features: string[];
  best?: boolean;
}

export interface AboutCopy {
  title: string;
  lead: string;
  journey: string;
  problem1: string;
  problem2: string;
  vision1: string;
  vision2: string;
  quote: string;
  photoAlt: string;
}

export interface EarlyAccessCopy {
  title: string;
  sub: string;
  nameLabel: string;
  emailLabel: string;
  cityLabel: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  error: string;
  helper: string;
  nameError: string;
  emailError: string;
  cityError: string;
}

const en: {
  navMenu: string;
  navCta: string;
  navLinks: string[];
  heroBars: string[];
  heroKicker: string;
  heroTitleA: string;
  heroTitleB: string;
  heroSub: string;
  galleryTitle: string;
  gallerySub: string;
  galleryCta: string;
  galleryMakeover: string;
  features: { name: string; num: string | null; active: boolean }[];
  capabilitiesTitle: string;
  capabilitiesSub: string;
  capabilities: CapabilityGroup[];
  screensTitle: string;
  screensSub: string;
  compareTitle: string;
  compareSub: string;
  compareApps: string[];
  compareLeft: string;
  compareRight: string;
  compareCta: string;
  comparePunch: string;
  dayTitle: string;
  daySub: string;
  moments: { time: string; text: string }[];
  howTitle: string;
  howSub: string;
  steps: { num: string; name: string; desc: string }[];
  faqTitle: string;
  faqSub: string;
  faq: { q: string; a: string }[];
  privacyTitle: string;
  privacySub: string;
  privacyPoints: Point[];
  videosTitle: string;
  videosSub: string;
  pricingTitle: string;
  pricingSub: string;
  recommended: string;
  about: AboutCopy;
  earlyAccess: EarlyAccessCopy;
  footerNote: string;
  privacyNote: string;
  rights: string;
} = {
  navMenu: 'Menu',
  navCta: 'Get early access',
  navLinks: ['Home', 'Features', 'Capabilities', 'App', 'Why', 'Pricing', 'FAQ'],
  heroBars: ['One health graph', 'Private by design', 'Free forever'],
  heroKicker: '10 apps. 10 subscriptions. Nothing connects them. HealthGraph does.',
  heroTitleA: 'Health,',
  heroTitleB: 'connected.',
  heroSub: 'Check your pulse with your camera. Log meds, meals, sleep, and cycle. Ask your own data what it means. One graph holds it all, on your phone instead of our servers. Free to start, free to keep.',
  galleryTitle: 'Every signal.',
  gallerySub: 'Measured on your phone, joined into one graph: nights explain mornings, meals explain afternoons',
  galleryCta: 'See how',
  galleryMakeover: 'Pulse\ncheck',
  features: [
    { name: 'Camera\nPulse', num: '01', active: true },
    { name: 'Medical\nDocuments', num: '02', active: false },
    { name: 'Medication\nSchedule', num: '03', active: false },
    { name: 'Sleep &\nRecovery', num: null, active: false },
  ],
  capabilitiesTitle: 'Everything.',
  capabilitiesSub: 'Sixteen capabilities, one graph. Each one earns its place by replacing an app you pay for',
  capabilities: [
    {
      title: 'Measure',
      items: [
        { name: 'Camera pulse', desc: 'Fingertip on the lens, 60 seconds. Heart rate plus HRV, no watch, no chest strap, no subscription. The phone already in your pocket is the wearable.', detail: 'The app reads tiny color shifts in your skin, the same photoplethysmography hospitals use, minus the clip on your finger. Morning and evening readings build your HRV baseline, which is how the readiness score knows you at all.' },
        { name: 'Face pulse', desc: 'A short selfie video becomes a pulse reading, computed on your device. Your face never uploads anywhere. Processed, then forgotten.', detail: 'Prop your phone up and look at it for half a minute. The same skin-color signal, read from your face. No touch needed. Every frame is analyzed on your device and never stored.' },
        { name: 'Vitals logger', desc: 'Blood pressure, glucose, weight, temperature, typed in once, trended forever. Your cuff and scale finally feed the same chart.', detail: 'Four dials, ten seconds each. Every entry lands timestamped in your graph, so your 7-day blood pressure average and weight trend are one tap away, ready to show your doctor, exported in seconds.' },
        { name: 'Food & barcode scan', desc: 'Point the camera at a barcode, get macros from a free food database. Scan again offline. Your phone remembers the product. No signal needed in the supermarket basement.', detail: 'The database is Open Food Facts: free, open, two million products. The first scan downloads the macros; every repeat scan after that works with zero bars of signal. Your most-scanned products live on your phone.' },
      ],
    },
    {
      title: 'Understand',
      items: [
        { name: 'Health graph', desc: 'Sleep, meds, meals, cycle, mood. Every entry lands in one connected graph. Why do Tuesdays feel heavy? Ask your own weeks, not generic advice.', detail: 'Sixteen capabilities write into one timeline. The graph does not care which screen you used. A bad night, a missed dose, and a heavy Tuesday finally sit side by side. Patterns stop hiding.' },
        { name: 'Priority engines', desc: 'Seven lenses that watch what matters: heart, sleep, fitness, nutrition, weight, wellbeing, discipline. Each one turns raw logs into one clear next step.', detail: 'Each engine watches its own signals and speaks only when it has something worth your attention. One clear next step, not a dashboard of dials competing for your anxiety.' },
        { name: 'Trends & timeline', desc: 'A longitudinal view of you, not just today. Scroll back months and watch habits compound. Or spot the week everything slipped.', detail: 'Every measurement ever, scrollable. Watch resting pulse drift down across a training block, or find the exact week the evening snacking started. Memory beats motivation.' },
        { name: 'Sanotts AI', desc: 'A health companion that answers from your data, receipts attached. “Why am I tired?” “Your last five short nights.” Not horoscope. Evidence.', detail: 'Ask in plain words, get answers footnoted to your own logs. It can only see your data. It cannot browse, cannot guess, cannot flatter. If the data does not support an answer, it says so.' },
      ],
    },
    {
      title: 'Manage',
      items: [
        { name: 'Medications', desc: 'Schedules, dose logging, refill-aware reminders that know your supply. Miss a linked dose and one tap notifies the family member you invited. From your phone. Never automatic.', detail: 'Schedules with dose logging, refill tracking that counts your supply down, and family watch for the doses that matter most. Snooze with a reason, and the graph learns the difference between forgot and chose.' },
        { name: 'Medical documents', desc: 'Scan lab reports and prescriptions, search them like email. Encrypted at rest, wiped on logout. Your filing cabinet, minus the cabinet.', detail: 'Lab PDFs, prescriptions, discharge papers. Photographed, text-searched, filed by date. Ask what your cholesterol was in March and get the number, not a folder to dig through.' },
        { name: 'Sleep & recovery', desc: 'Nights, naps, bedtimes, wake times. See which evenings buy you good mornings. And which ones charge interest.', detail: 'Bedtime, wake time, naps, quality notes. The engine pairs nights with next-day energy until your personal formula appears: which bedtime actually buys you a good morning.' },
        { name: 'Cycle & substance', desc: 'Cycle tracking with fertile-window planning, TTC and pregnancy modes, plus substance logs with pledges and money-saved counters. Judgment-free by design.', detail: 'Period tracking with planning modes, perimenopause notes, plus substance logs with pledges and a running money-saved total. Private, unjudged, exportable.' },
      ],
    },
    {
      title: 'Act',
      items: [
        { name: 'Voice check-in calls', desc: 'A daily call that logs for you, hands-free. Talk for a minute while the kettle boils; your timeline fills itself in.', detail: 'One scheduled call a day. The voice asks, you answer, the timeline fills: sleep, meds, mood, symptoms. Miss the call and it tries once more; ignore it twice and it leaves you alone.' },
        { name: 'Voice alarms', desc: 'Spoken reminders you simply answer. Say what you took, ate, or felt. No typing, no unlocking, no excuses.', detail: 'Alarms that talk and listen. “Did you take the midday dose?” Answer taken and it is logged with a timestamp. No unlocking, no typing, no I will log it later.' },
        { name: '3D body', desc: 'A full anatomy view wired straight to your graph: zones, organs, both included. Tap your chest and see your heart data. It works offline, because the model ships inside the app.', detail: 'Male and female shells with seven organ meshes, generated by this project and shipped inside the app. No downloads, no licenses, works in airplane mode. Tap a zone and the graph answers with your data for it.' },
        { name: 'Your data rights', desc: 'Export everything or delete everything, any time, in one tap. DSGVO-compliant. Never sold. It never leaves your hands in the first place.', detail: 'One tap exports everything in open formats; one tap deletes everything. No retention tricks, no contact-support-to-delete. Leaving is easy, which is exactly why staying is a choice.' },
      ],
    },
  ],
  screensTitle: 'The app.',
  screensSub: 'Three screens, one graph',
  compareTitle: 'The graveyard.',
  compareSub: 'Count the health apps on your phone. Then count the subscriptions.',
  compareApps: [
    'Sleep tracker', 'Calorie counter', 'Medication reminder', 'Period tracker', 'Running app',
    'Meditation app', 'Water reminder', 'Symptom checker', 'Document scanner', 'Habit tracker',
  ],
  compareLeft: 'Ten apps. Ten logins. Ten subscriptions. None of them knows what the others know.',
  compareRight: 'Sixteen capabilities. One graph. Sleep explains mornings, meals explain afternoons, meds explain the flat weeks, because for the first time, everything is in the same place.',
  compareCta: 'Get early access',
  comparePunch: '$48.93 a month for chaos. HealthGraph: sixteen capabilities, one graph, €0 to start.',
  dayTitle: 'A day with it.',
  daySub: 'Not a dashboard you admire. A rhythm you barely notice.',
  moments: [
    { time: '07:12', text: 'Your alarm speaks. You answer half-asleep: slept badly, shoulder aches. Logged before your feet touch the floor.' },
    { time: '08:05', text: 'Breakfast barcode, one scan. Oats, again. Your phone remembers the product. No signal needed, no typing.' },
    { time: '13:40', text: 'The midday dose was due at 13:00. One tap notifies your sister, straight from your phone. She texts back: proud of you.' },
    { time: '19:22', text: 'Finger on the camera, sixty seconds. Heart rate, HRV, done, while the pasta water boils.' },
    { time: '22:47', text: 'The graph shows it plainly: short nights cluster before heavy days. Tomorrow you protect the evening. That is the whole trick.' },
  ],
  howTitle: 'How it works.',
  howSub: 'Three moves. Sixty seconds at a time.',
  steps: [
    { num: '01', name: 'Measure', desc: 'Pulse, meals, meds, sleep, symptoms, captured by camera, barcode, voice, or a ten-second tap. Whatever costs you the least effort wins.' },
    { num: '02', name: 'Connect', desc: 'Everything lands in one graph. Nights explain mornings, meals explain afternoons, meds explain the flat weeks. Correlations surface on their own.' },
    { num: '03', name: 'Act', desc: 'Seven priority engines turn patterns into one clear next step. Refill before you run out. Protect the evening. Call your sister. Small moves, compounded.' },
  ],
  faqTitle: 'Fair questions.',
  faqSub: 'Asked by people who have been burned by health apps before.',
  faq: [
    { q: 'Is this a medical device?', a: 'No. HealthGraph is a wellness companion, a clearer mirror, not a doctor. It never diagnoses, stages, or treats anything. Anything that looks clinical belongs in front of your actual clinician, and the app says so wherever it matters.' },
    { q: 'Where does my data live?', a: 'On your phone first. Camera and face pulse never leave it; cached files are encrypted and wiped on logout. Export or delete everything in one tap, any time. DSGVO-compliant, never sold.' },
    { q: 'What does free actually include?', a: 'Daily logging and check-ins, medications with dose tracking, the timeline, 3 meal scans and 2 AI messages a month. Free means free. The paid tiers unlock unlimited lenses like camera pulse, the full graph, and voice features.' },
    { q: 'Do I need a wearable?', a: 'No. Your fingertip on the camera gives heart rate and HRV in sixty seconds; a short selfie video does the same for face pulse. Wearables are welcome guests, never requirements.' },
    { q: 'How does family watch work?', a: 'You invite someone you trust and pick which medications they watch. If a linked dose is missed, you tap once and your SMS app opens with the message ready. Nothing is ever sent automatically. Your tap is the consent, every time.' },
    { q: 'Which phones and languages?', a: 'Early access runs on Android, in English and German. Your invite email tells you exactly what to install.' },
  ],
  privacyTitle: 'Private.',
  privacySub: 'Device-first by design. Your data never has to leave your hand to be useful',
  privacyPoints: [
    { name: 'On device', desc: 'Camera pulse, face pulse, and the health graph itself live on your phone. The cloud is a backup you control, not a business model.' },
    { name: 'Encrypted', desc: 'Cached files are encrypted at rest and wiped the moment you log out. Lose your phone and your health history does not go with it.' },
    { name: 'GDPR aware', desc: 'DSGVO-compliant, export and deletion in one tap. Your health data is never sold. We would have to have it first, and we do not.' },
    { name: 'Yours to take', desc: 'Full export in open formats, full deletion with no dark patterns. Leaving is easy, which is exactly why you will not want to.' },
  ],
  videosTitle: 'Watch.',
  videosSub: 'The story in sixty seconds: why ten apps became one graph',
  pricingTitle: 'Pricing.',
  pricingSub: 'Start free and stay free as long as you like. Upgrade only when the advanced lenses earn it.',
  recommended: 'Recommended',
  about: {
    title: 'Two builders.',
    lead: "We're two independent builders brought together by a shared interest in AI, healthcare, design, and everyday technology that means something.",
    journey: "One of us works with AI, software, healthcare systems, and knowledge graphs. The other shapes how technology feels to the people using it. Neither of us comes from healthcare, and we don't claim to be medical professionals. We saw a problem worth exploring, so we learned, experimented, and built our way toward a possible solution. HealthGraph grew from that journey.",
    problem1: 'Health information is everywhere, but rarely connected. Reports live in one place, prescriptions in another, and fitness, sleep, and food each in an app of their own.',
    problem2: "Your health isn't fragmented. Your records are.",
    vision1: "We don't believe the future of digital health is ten apps for ten parts of your life. It's one connected experience: records, medications, measurements, daily habits, and your history, joined into a clearer picture over time.",
    vision2: 'Not another app for the collection. One place where your health comes together.',
    quote: 'Your health is a connected story. Your technology should understand it that way.',
    photoAlt: 'The two builders behind HealthGraph',
  },
  earlyAccess: {
    title: 'Early access.',
    sub: 'Leave your name, email and city. We email your early-access invite with the free trial, usually within days, never into a spam folder you will never check.',
    nameLabel: 'Name',
    emailLabel: 'Email',
    cityLabel: 'City',
    submit: 'Get early access',
    submitting: 'Sending…',
    successTitle: "You're on the list.",
    successBody: 'Your invite will land in your inbox. Keep an eye out.',
    error: "Couldn't send. Check your connection and try again.",
    helper: 'We only use these details for your invite.',
    nameError: 'Please tell us your name.',
    emailError: "That email doesn't look right.",
    cityError: 'Please tell us your city.',
  },
  footerNote: 'HealthGraph is a wellness companion, not a medical device. Nothing here is medical advice, diagnosis, or treatment. It is a clearer mirror, not a doctor.',
  privacyNote: 'Your health data belongs to you. DSGVO/GDPR aware. Never sold.',
  rights: 'All rights reserved.',
};

const de: typeof en = {
  navMenu: 'Menü',
  navCta: 'Zugang sichern',
  navLinks: ['Start', 'Funktionen', 'Fähigkeiten', 'App', 'Warum', 'Preise', 'FAQ'],
  heroBars: ['Ein Gesundheitsgraph', 'Privat per Design', 'Für immer kostenlos'],
  heroKicker: '10 Apps. 10 Abos. Nichts verbindet sie. HealthGraph schon.',
  heroTitleA: 'Gesundheit,',
  heroTitleB: 'verbunden.',
  heroSub: 'Puls per Kamera messen. Medis, Essen, Schlaf und Zyklus loggen. Deine eigenen Daten fragen, was das bedeutet. Ein Graph hält alles, auf deinem Handy statt auf unseren Servern. Kostenlos starten, kostenlos behalten.',
  galleryTitle: 'Jedes Signal.',
  gallerySub: 'Am Handy gemessen, in einem Graph verbunden: Nächte erklären Morgen, Essen erklärt Nachmittage',
  galleryCta: 'Ansehen',
  galleryMakeover: 'Puls\ncheck',
  features: [
    { name: 'Kamera\nPuls', num: '01', active: true },
    { name: 'Medizinische\nDokumente', num: '02', active: false },
    { name: 'Medikamenten\nPlan', num: '03', active: false },
    { name: 'Schlaf &\nErholung', num: null, active: false },
  ],
  capabilitiesTitle: 'Alles.',
  capabilitiesSub: 'Sechzehn Fähigkeiten, ein Graph. Jede einzelne ersetzt eine App, für die du zahlst',
  capabilities: [
    {
      title: 'Messen',
      items: [
        { name: 'Kamera-Puls', desc: 'Finger auf die Linse, 60 Sekunden, und du hast Herzfrequenz plus HRV. Keine Uhr, kein Brustgurt, kein Abo. Läuft auf dem Handy, das eh in deiner Tasche ist.', detail: 'Die App liest winzige Farbverschiebungen deiner Haut, dieselbe Photoplethysmographie wie im Krankenhaus, minus Clip am Finger. Morgen- und Abendmessungen bauen deine HRV-Basis, und nur so kennt der Bereitschaftswert dich überhaupt.' },
        { name: 'Gesichts-Puls', desc: 'Ein kurzes Selfie-Video wird zur Pulsmessung, direkt am Gerät gerechnet. Dein Gesicht lädt nirgends hoch; das Video wird verarbeitet und vergessen.', detail: 'Handy aufstellen, eine halbe Minute hineinschauen. Dasselbe Hautfarb-Signal, vom Gesicht gelesen. Ganz ohne Berührung. Jeder Frame wird am Gerät analysiert und nie gespeichert.' },
        { name: 'Vitalwerte', desc: 'Blutdruck, Zucker, Gewicht, Temperatur, einmal eingetippt, für immer im Trend. Manschette und Waage füttern endlich dasselbe Diagramm.', detail: 'Vier Regler, je zehn Sekunden. Jeder Eintrag landet mit Zeitstempel im Graph. Dein 7-Tage-Blutdruckmittel und dein Gewichtstrend sind einen Tipp entfernt. Bereit für den Arztbesuch, in Sekunden exportiert.' },
        { name: 'Food- & Barcode-Scan', desc: 'Kamera auf den Barcode, Makros aus einer freien Lebensmitteldatenbank. Beim zweiten Scan kennt dein Handy das Produkt schon. Offline, im Supermarktkeller ohne Empfang.', detail: 'Die Datenbank heißt Open Food Facts: frei, offen, zwei Millionen Produkte. Der erste Scan lädt die Makros; jeder Scan danach geht mit null Balken Empfang. Deine meistgescannten Produkte wohnen auf deinem Handy.' },
      ],
    },
    {
      title: 'Verstehen',
      items: [
        { name: 'Health-Graph', desc: 'Schlaf, Medis, Essen, Zyklus, Stimmung. Jeder Eintrag landet in einem verbundenen Graph. Frag, warum Dienstage sich schwer anfühlen, und bekomm eine Antwort aus deinen eigenen Wochen, nicht aus dem Kalender.', detail: 'Sechzehn Fähigkeiten schreiben in eine Timeline. Dem Graph ist egal, welchen Screen du benutzt hast. Schlechte Nacht, vergessene Dosis und schwerer Dienstag liegen endlich nebeneinander. Muster hören auf, sich zu verstecken.' },
        { name: 'Priority-Engines', desc: 'Sieben Blickwinkel, die aufpassen, was zählt: Herz, Schlaf, Fitness, Ernährung, Gewicht, Wohlbefinden, Disziplin. Jede macht aus rohen Logs einen klaren nächsten Schritt.', detail: 'Jede Engine beobachtet ihre eigenen Signale und meldet sich nur, wenn sie etwas hat, das deine Aufmerksamkeit verdient. Ein klarer nächster Schritt. Kein Armaturenbrett voller Zeiger, die um deine Sorge konkurrieren.' },
        { name: 'Trends & Timeline', desc: 'Dein Langzeitverlauf, nicht nur heute. Scroll Monate zurück und sieh, wie Gewohnheiten sich summieren. Oder in welcher Woche alles gerissen ist.', detail: 'Jede Messung aller Zeiten, scrollbar. Sieh, wie der Ruhepuls über einen Trainingsblock sinkt, oder finde die exakte Woche, in der das Abendsnacken anfing. Erinnerung schlägt Motivation.' },
        { name: 'Sanotts KI', desc: 'Ein Gesundheitsbegleiter, der aus deinen Daten antwortet, mit Belegen. „Warum bin ich müde?“ bekommt „deine letzten fünf kurzen Nächte“, kein Horoskop.', detail: 'Frag in normalen Worten, bekomm Antworten mit Fußnoten zu deinen Logs. Sie sieht nur deine Daten. Sie surft nicht, rät nicht, schmeichelt nicht. Wenn die Daten keine Antwort hergeben, sagt sie das.' },
      ],
    },
    {
      title: 'Verwalten',
      items: [
        { name: 'Medikamente', desc: 'Pläne, Dosen-Logging, Nachfüll-Erinnerungen, die deinen Vorrat kennen. Verpasste Dosis? Ein Tipp benachrichtigt die Person, die du eingeladen hast. Von deinem Handy, niemals automatisch.', detail: 'Pläne mit Dosen-Logging, Nachfüll-Tracking, das deinen Vorrat herunterzählt, und Family Watch für die Dosen, die wirklich zählen. Schlummern mit Grund. Und der Graph lernt den Unterschied zwischen vergessen und entschieden.' },
        { name: 'Medizinische Dokumente', desc: 'Laborbefunde und Rezepte scannen, durchsuchen wie E-Mails. Verschlüsselt gespeichert, beim Logout gelöscht. Dein Aktenschrank, minus Schrank.', detail: 'Labor-PDFs, Rezepte, Entlassbriefe. Fotografiert, texterkannt, nach Datum abgelegt. Frag, was dein Cholesterin im März war, und bekomm die Zahl, nicht einen Ordner zum Wühlen.' },
        { name: 'Schlaf & Erholung', desc: 'Nächte, Nickerchen, Bett- und Aufstehzeiten. Sieh, welche Abende dir gute Morgen kaufen. Und welche Zinsen verlangen.', detail: 'Bettzeit, Aufstehzeit, Nickerchen, Qualitätsnotizen. Die Engine paart Nächte mit Tagesenergie, bis deine persönliche Formel auftaucht: welche Bettzeit dir wirklich einen guten Morgen kauft.' },
        { name: 'Zyklus & Substanzen', desc: 'Zyklustracking mit Fruchtbarkeitsplanung, Kinderwunsch- und Schwangerschaftsmodus, dazu Substanz-Logs mit Zielen und Ersparniszähler. Ohne erhobenen Zeigefinger.', detail: 'Periodentracking mit Planungsmodi, Perimenopausen-Notizen, dazu Substanz-Logs mit Zielen und laufender Ersparnis. Privat, unbewertet, exportierbar.' },
      ],
    },
    {
      title: 'Handeln',
      items: [
        { name: 'Sprach-Check-in-Anrufe', desc: 'Ein täglicher Anruf, der für dich loggt. Eine Minute reden, während der Wasserkocher läuft; deine Timeline füllt sich von selbst.', detail: 'Ein geplanter Anruf am Tag. Die Stimme fragt, du antwortest, die Timeline füllt sich: Schlaf, Medis, Stimmung, Symptome. Verpasst du ihn, versucht sie es einmal mehr; ignorierst du zweimal, lässt sie dich in Ruhe.' },
        { name: 'Sprach-Alarme', desc: 'Gesprochene Erinnerungen, die du einfach beantwortest. Sag, was du genommen, gegessen, gefühlt hast. Kein Tippen, kein Entsperren, keine Ausreden.', detail: 'Alarme, die reden und zuhören. „Mittagsdosis genommen?“ Antwortest du „genommen“, ist es mit Zeitstempel geloggt. Kein Entsperren, kein Tippen, kein ich-trag-es-später-nach.' },
        { name: '3D-Körper', desc: 'Eine komplette Anatomie-Ansicht, direkt mit deinem Graph verdrahtet: Zonen, Organe, alles dabei. Tipp auf die Brust und sieh deine Herzdaten. Läuft offline, weil das Modell in der App steckt.', detail: 'Männliche und weibliche Hüllen mit sieben Organ-Meshes, von diesem Projekt erzeugt und in der App mitgeliefert. Keine Downloads, keine Lizenzen, geht im Flugmodus. Tipp auf eine Zone und der Graph antwortet mit deinen Daten dazu.' },
        { name: 'Deine Datenrechte', desc: 'Alles exportieren oder alles löschen, jederzeit, mit einem Tipp. DSGVO-konform. Deine Daten werden nie verkauft. Sie verlassen deine Hände gar nicht erst.', detail: 'Ein Tipp exportiert alles in offenen Formaten; ein Tipp löscht alles. Keine Aufbewahrungstricks, kein Support-Anrufen-zum-Löschen. Gehen ist leicht. Genau deshalb ist Bleiben eine Entscheidung.' },
      ],
    },
  ],
  screensTitle: 'Die App.',
  screensSub: 'Drei Screens, ein Graph',
  compareTitle: 'Der Friedhof.',
  compareSub: 'Zähl die Gesundheits-Apps auf deinem Handy. Dann zähl die Abos.',
  compareApps: [
    'Schlaf-Tracker', 'Kalorienzähler', 'Medikamenten-Erinnerung', 'Zyklus-Tracker', 'Lauf-App',
    'Meditations-App', 'Wasser-Erinnerung', 'Symptom-Checker', 'Dokumenten-Scanner', 'Gewohnheits-Tracker',
  ],
  compareLeft: 'Zehn Apps. Zehn Logins. Zehn Abos. Keine weiß, was die anderen wissen.',
  compareRight: 'Sechzehn Fähigkeiten. Ein Graph. Schlaf erklärt Morgen, Essen erklärt Nachmittage, Medis erklären die flachen Wochen, weil zum ersten Mal alles am selben Ort ist.',
  compareCta: 'Zugang sichern',
  comparePunch: '48,93 $ im Monat für Chaos. HealthGraph: sechzehn Fähigkeiten, ein Graph, 0 € zum Start.',
  dayTitle: 'Ein Tag damit.',
  daySub: 'Kein Dashboard zum Bewundern. Ein Rhythmus, den du kaum bemerkst.',
  moments: [
    { time: '07:12', text: 'Dein Wecker spricht. Du antwortest im Halbschlaf: schlecht geschlafen, Schulter zieht. Geloggt, bevor deine Füße den Boden berühren.' },
    { time: '08:05', text: 'Frühstücks-Barcode, ein Scan. Haferflocken, wie immer. Dein Handy kennt das Produkt schon. Kein Empfang nötig, kein Tippen.' },
    { time: '13:40', text: 'Die Mittagsdosis war um 13:00 fällig. Ein Tipp benachrichtigt deine Schwester, direkt von deinem Handy. Sie schreibt zurück: stolz auf dich.' },
    { time: '19:22', text: 'Finger auf die Kamera, sechzig Sekunden. Puls, HRV, fertig, während das Nudelwasser kocht.' },
    { time: '22:47', text: 'Der Graph zeigt es schlicht: Kurze Nächte häufen sich vor schweren Tagen. Morgen schützt du den Abend. Das ist der ganze Trick.' },
  ],
  howTitle: 'So geht’s.',
  howSub: 'Drei Schritte. Je sechzig Sekunden.',
  steps: [
    { num: '01', name: 'Messen', desc: 'Puls, Essen, Medis, Schlaf, Symptome, per Kamera, Barcode, Stimme oder Zehn-Sekunden-Tipp. Was dich am wenigsten kostet, gewinnt.' },
    { num: '02', name: 'Verbinden', desc: 'Alles landet in einem Graph. Nächte erklären Morgen, Essen erklärt Nachmittage, Medis erklären die flachen Wochen. Zusammenhänge zeigen sich von selbst.' },
    { num: '03', name: 'Handeln', desc: 'Sieben Priority-Engines machen aus Mustern einen klaren nächsten Schritt. Vorrat auffüllen, bevor er leer ist. Den Abend schützen. Die Schwester anrufen. Kleine Schritte, zusammengesetzt.' },
  ],
  faqTitle: 'Ehrliche Fragen.',
  faqSub: 'Gefragt von Leuten, die von Gesundheits-Apps schon enttäuscht wurden.',
  faq: [
    { q: 'Ist das ein Medizinprodukt?', a: 'Nein. HealthGraph ist ein Wellness-Begleiter, ein klarerer Spiegel, kein Arzt. Es diagnostiziert nichts, stuft nichts ein, behandelt nichts. Was klinisch aussieht, gehört vor deine Ärztin oder deinen Arzt, und die App sagt das auch, wo es zählt.' },
    { q: 'Wo leben meine Daten?', a: 'Zuerst auf deinem Handy. Kamera- und Gesichts-Puls verlassen es nie; zwischengespeicherte Dateien sind verschlüsselt und werden beim Logout gelöscht. Alles exportieren oder löschen mit einem Tipp, jederzeit. DSGVO-konform, niemals verkauft.' },
    { q: 'Was heißt kostenlos wirklich?', a: 'Tägliches Logging und Check-ins, Medikamente mit Dosen-Tracking, die Timeline, 3 Meal-Scans und 2 KI-Nachrichten im Monat. Kostenlos heißt kostenlos. Die Bezahlstufen schalten unbegrenzte Linsen frei: Kamera-Puls, den vollen Graphen, Sprachfunktionen.' },
    { q: 'Brauche ich ein Wearable?', a: 'Nein. Dein Finger auf der Kamera gibt Puls und HRV in sechzig Sekunden; ein kurzes Selfie-Video dasselbe für den Gesichts-Puls. Wearables sind willkommene Gäste, niemals Pflicht.' },
    { q: 'Wie funktioniert Family Watch?', a: 'Du lädst jemanden ein, dem du vertraust, und wählst, welche Medikamente er sieht. Wird eine verknüpfte Dosis verpasst, tippst du einmal und deine SMS-App öffnet sich mit fertiger Nachricht. Automatisch wird nie etwas gesendet. Dein Tipp ist jedes Mal die Zustimmung.' },
    { q: 'Welche Handys und Sprachen?', a: 'Der Early Access läuft auf Android, auf Englisch und Deutsch. Deine Einladungs-Mail sagt dir genau, was du installierst.' },
  ],
  privacyTitle: 'Privat.',
  privacySub: 'Device-first by Design. Deine Daten müssen deine Hand nie verlassen, um nützlich zu sein',
  privacyPoints: [
    { name: 'Am Gerät', desc: 'Kamera-Puls, Gesichts-Puls und der Health-Graph selbst leben auf deinem Handy. Die Cloud ist ein Backup, das du kontrollierst. Kein Geschäftsmodell.' },
    { name: 'Verschlüsselt', desc: 'Dateien verschlüsselt gespeichert, beim Logout gelöscht. Verlierst du dein Handy, geht deine Gesundheitsgeschichte nicht mit.' },
    { name: 'DSGVO-konform', desc: 'Export und Löschung mit einem Tipp. Deine Gesundheitsdaten werden niemals verkauft. Wir müssten sie dafür erst haben, und das tun wir nicht.' },
    { name: 'Deins zum Mitnehmen', desc: 'Voller Export in offenen Formaten, volle Löschung ohne dunkle Muster. Gehen ist leicht. Genau deshalb willst du nicht.' },
  ],
  videosTitle: 'Ansehen.',
  videosSub: 'Die Geschichte in sechzig Sekunden: warum aus zehn Apps ein Graph wurde',
  pricingTitle: 'Preise.',
  pricingSub: 'Kostenlos starten und kostenlos bleiben, so lange du willst. Upgraden erst, wenn die Profi-Linsen es verdienen.',
  recommended: 'Empfohlen',
  about: {
    title: 'Zwei Macher.',
    lead: 'Wir sind zwei unabhängige Macher, verbunden durch ein gemeinsames Interesse an KI, Healthcare, Design und Alltagstechnologie, die etwas bedeutet.',
    journey: 'Einer von uns arbeitet mit KI, Software, Gesundheitssystemen und Knowledge Graphs. Der andere gestaltet, wie sich Technologie für die Menschen anfühlt, die sie benutzen. Keiner von uns kommt aus dem Gesundheitswesen, und wir geben nicht vor, medizinische Profis zu sein. Wir haben ein Problem gesehen, das sich zu erforschen lohnt, haben gelernt, experimentiert und uns auf den Weg gemacht, eine mögliche Lösung zu bauen. HealthGraph ist aus diesem Weg entstanden.',
    problem1: 'Gesundheitsinformationen sind überall, aber selten verbunden. Befunde liegen hier, Rezepte dort, und Fitness, Schlaf und Essen haben jeweils eine eigene App.',
    problem2: 'Deine Gesundheit ist nicht fragmentiert. Deine Unterlagen schon.',
    vision1: 'Wir glauben nicht, dass digitale Gesundheit zehn Apps für zehn Lebensbereiche braucht. Sie braucht eine verbundene Erfahrung: Befunde, Medikamente, Messwerte, tägliche Gewohnheiten und deine Geschichte, verbunden zu einem klareren Bild über die Zeit.',
    vision2: 'Keine weitere App für die Sammlung. Ein Ort, an dem deine Gesundheit zusammenkommt.',
    quote: 'Deine Gesundheit ist eine verbundene Geschichte. Deine Technik sollte sie auch so verstehen.',
    photoAlt: 'Die zwei Macher hinter HealthGraph',
  },
  earlyAccess: {
    title: 'Früher Zugang.',
    sub: 'Hinterlasse Name, E-Mail und Stadt. Wir mailen dir deine Einladung mit der kostenlosen Testphase, meist in Tagen, nie in einen Spam-Ordner, den du nie öffnest.',
    nameLabel: 'Name',
    emailLabel: 'E-Mail',
    cityLabel: 'Stadt',
    submit: 'Zugang sichern',
    submitting: 'Wird gesendet…',
    successTitle: 'Du bist auf der Liste.',
    successBody: 'Deine Einladung kommt per E-Mail. Halte dein Postfach im Auge.',
    error: 'Senden fehlgeschlagen. Prüf deine Verbindung und versuch es nochmal.',
    helper: 'Wir nutzen diese Angaben nur für deine Einladung.',
    nameError: 'Bitte verrate uns deinen Namen.',
    emailError: 'Diese E-Mail sieht nicht richtig aus.',
    cityError: 'Bitte verrate uns deine Stadt.',
  },
  footerNote: 'HealthGraph ist ein Wellness-Begleiter, kein Medizinprodukt. Keine Heilaussagen, keine Diagnosen. Ein klarerer Spiegel, kein Arzt.',
  privacyNote: 'Deine Gesundheitsdaten gehören dir. DSGVO-konform. Werden niemals verkauft.',
  rights: 'Alle Rechte vorbehalten.',
};

export const copy: Record<Locale, typeof en> = { en, de };

export interface VideoItem {
  file: string;
  poster: string;
  title: string;
  caption: string;
}

export const videos: Record<Locale, VideoItem[]> = {
  en: [
    {
      file: '/videos/en/health-independence.mp4',
      poster: '/poster-independence.jpg',
      title: 'Declare health independence',
      caption: 'Your health data belongs to you. 10 apps. 10 subscriptions. One app breaks you free.',
    },
    {
      file: '/videos/en/health-data-war.mp4',
      poster: '/poster-war.jpg',
      title: 'The tax on your health',
      caption: '$48.93/month for chaos. HealthGraph: 10 features, one graph, $0 forever.',
    },
  ],
  de: [
    {
      file: '/videos/de/feature-cascade.mp4',
      poster: '/poster-cascade.jpg',
      title: 'Feature-Kaskade',
      caption: 'Schlaf, Medis, Puls, Dokumente, Blutwerte und Ernährung in einem Graph. Kostenlos. DSGVO-konform.',
    },
    {
      file: '/videos/de/app-graveyard.mp4',
      poster: '/poster-graveyard.jpg',
      title: 'Der App-Friedhof',
      caption: '10 Gesundheits-Apps und nichts hängt zusammen. HealthGraph: 0 €. 10 Funktionen. 1 Graph.',
    },
  ],
};

export const tiers: Record<Locale, Tier[]> = {
  en: [
    {
      name: 'Free', price: '€0', per: 'forever', cta: 'Start free',
      features: ['Daily logging & check-ins', 'Medications & dose tracking', 'Timeline & history', '3 meal scans a month', '2 AI messages a month'],
    },
    {
      name: 'General', price: '€11', per: '/mo', cta: 'Choose General', best: true,
      features: ['Everything in Free, unlimited', 'Camera pulse (PPG)', 'Health graph & correlations', 'Priority engines', '4 document scans a month', 'Unlimited food scans'],
    },
    {
      name: 'All-in', price: '€18', per: '/mo', cta: 'Choose All-in',
      features: ['Everything in General', 'Face pulse (rPPG)', '3D body included', 'Voice alarms & call reminders', 'Unlimited AI chat', 'Unlimited document scans'],
    },
  ],
  de: [
    {
      name: 'Free', price: '0 €', per: 'für immer', cta: 'Kostenlos starten',
      features: ['Tägliches Logging & Check-ins', 'Medikamente & Dosen-Tracking', 'Timeline & Verlauf', '3 Meal-Scans pro Monat', '2 KI-Nachrichten pro Monat'],
    },
    {
      name: 'General', price: '11 €', per: '/Monat', cta: 'General wählen', best: true,
      features: ['Alles aus Free, unbegrenzt', 'Kamera-Puls (PPG)', 'Health-Graph & Korrelationen', 'Priority-Engines', '4 Dokument-Scans pro Monat', 'Unbegrenzte Food-Scans'],
    },
    {
      name: 'All-in', price: '18 €', per: '/Monat', cta: 'All-in wählen',
      features: ['Alles aus General', 'Gesichts-Puls (rPPG)', '3D-Körper inklusive', 'Sprach-Alarme & Anruf-Erinnerungen', 'Unbegrenzter KI-Chat', 'Unbegrenzte Dokument-Scans'],
    },
  ],
};
