export interface Artikel {
  slug: string;
  cluster: string;
  h1: string;
  lede: string;
  persona: string;
  problem: string;
  loesung: string[];
  preis: 'general' | 'allin' | 'free-general';
  visual: string;
  queries: string[];
  faq: { q: string; a: string }[];
}

// Cluster A: Herz & Puls ohne Uhr (1-8) + Start B (9-10)
export const ARTIKEL_A: Artikel[] = [
  {
    slug: 'puls-messen-ohne-uhr-anleitung',
    cluster: 'Herz & Puls',
    h1: 'Puls messen ohne Uhr: 60 Sekunden mit der Handykamera',
    lede: 'Kein Wearable, kein Abo, kein Aufladen. Finger auf die Linse, 60 Sekunden ruhig halten — Puls plus HRV landen direkt in deinem Graph.',
    persona: 'Monika (58) aus Dortmund hat ihre Smartwatch nach zwei Wochen in die Schublade gelegt: Laden vergessen, Armband juckt, Abo kostet. Jetzt misst sie morgens am Küchentisch — während das Wasser kocht.',
    problem: 'Ohne Messung kein Verlauf. Ohne Verlauf kein Gespräch beim Hausarzt — nur „mir geht es so lala“. Wearables kosten 200–400 € plus 5–10 € im Monat, und viele tragen sie nach 3 Monaten nicht mehr.',
    loesung: [
      'Messen: Finger 60 Sekunden auf die Linse, Licht anlassen, Handy ablegen. HealthGraph liest winzige Hautfarb-Schwankungen (PPG) — dasselbe Prinzip wie Klinik-Clips, als Wellness-Trend.',
      'Verbinden: Jede Messung landet mit Zeitstempel im Graph. Morgen- und Abendwerte bauen deine HRV-Baseline. Du siehst: Ruhepuls sinkt im Training, springt in Stresswochen.',
      'Handeln: 7-Tage-Mittel in einem Tipp exportieren und zum Hausarzt mitnehmen. Kein Zettel, kein Raten.',
    ],
    preis: 'general',
    visual: 'hero-puls.svg',
    queries: ['camera-pulse-heart-rate-no-watch', 'de-puls-messen-kamera-ohne-uhr', 'de-hrv-messen-ohne-wearable'],
    faq: [
      { q: 'Brauche ich eine Smartwatch?', a: 'Nein. Finger plus Selfie-Video decken Puls und HRV ab. Wearables sind Gäste, niemals Pflicht.' },
      { q: 'Wie genau ist das?', a: 'PPG ist dasselbe optische Prinzip wie in Kliniken. Am Handy ist es ein Wellness-Trend, kein Medizinprodukt — gut für Verläufe, nicht für Diagnosen.' },
      { q: 'Was kostet das?', a: 'Kamera-Puls ist in General (11 €/Monat) unbegrenzt. Free reicht zum Starten: Logging, Timeline, 3 Meal-Scans.' },
    ],
  },
  {
    slug: 'hrv-verstehen-normalwerte',
    cluster: 'Herz & Puls',
    h1: 'HRV verstehen: Was ist normal für dich?',
    lede: 'Nicht der Einzelwert zählt, sondern deine Baseline. So baust du sie in 2 Wochen auf — morgens und abends, je 60 Sekunden.',
    persona: 'Jens (44) aus Leipzig dachte, HRV 42 ms sei „schlecht“. Nach 14 Tagen sah er: Sein Normal ist 38–46. Erst Abweichungen nach kurzen Nächten wurden spannend.',
    problem: 'Einzelne HRV-Werte aus dem Internet vergleichen macht nur Angst. Ohne Baseline verwechselst du Rauschen mit Signal und kaufst das nächste Abo.',
    loesung: [
      'Messen: 14 Tage morgens + abends je 60 Sekunden. Immer gleiche Haltung, gleiche Tageszeit.',
      'Verbinden: HealthGraph baut daraus deine Spanne. Die Readiness-Linse lernt, was für dich normal ist.',
      'Handeln: Fällt HRV 3 Tage nach kurzen Nächten, schützt du den Abend — statt ein neues Supplement zu bestellen.',
    ],
    preis: 'general',
    visual: 'grafik-naechte.svg',
    queries: ['hrv-baseline-morning-evening', 'de-hrv-messen-ohne-wearable'],
    faq: [
      { q: 'Welcher HRV-Wert ist gut?', a: 'Deiner. 30–80 ms sind je nach Alter, Schlaf und Training normal. Wichtig ist deine Spanne über 2 Wochen.' },
      { q: 'Reicht einmal messen?', a: 'Nein. Morgens zeigt Erholung, abends den Tag. Erst beide bauen die Baseline.' },
      { q: 'Muss ich dafür zahlen?', a: 'Für die volle HRV-Historie: General 11 €. Free zeigt dir Logging und Timeline zum Reinkommen.' },
    ],
  },
  {
    slug: 'ruhepuls-senken-training',
    cluster: 'Herz & Puls',
    h1: 'Ruhepuls senken: Training endlich sichtbar machen',
    lede: 'Du trainierst 8 Wochen und siehst nichts? Scroll Monate zurück und sieh, wie dein Ruhepuls leise sinkt — das hält dich dran.',
    persona: 'Aylin (36) aus Köln joggt 2× pro Woche. Die Waage zappelt, aber ihr Ruhepuls fiel in 10 Wochen von 71 auf 64. Das Bild hat sie nicht aufgegeben.',
    problem: 'Ohne Trend wirfst du nach 3 Wochen hin. Fitness-Apps zeigen Workouts, nicht deine Erholung. Motivation stirbt ohne Beweis.',
    loesung: [
      'Messen: Täglich 60 Sekunden, am besten morgens vor Kaffee.',
      'Verbinden: Trends & Timeline über Monate scrollen. Training, Schlaf und Puls liegen nebeneinander.',
      'Handeln: Fällt der Puls, bleibst du dran. Steigt er nach Infekt oder Stress, nimmst du raus — mit Beleg statt Schuldgefühl.',
    ],
    preis: 'general',
    visual: 'hero-puls.svg',
    queries: ['resting-pulse-trend-training'],
    faq: [
      { q: 'Wie schnell sinkt der Ruhepuls?', a: 'Oft 4–10 Schläge in 8–12 Wochen bei 2–3 Einheiten pro Woche. Schlaf und Infekte überlagern das — der Trend zählt.' },
      { q: 'Brauche ich einen Brustgurt?', a: 'Nein. Für den Ruhe-Trend reicht die Kamera. Gurt ist Kür, nicht Pflicht.' },
    ],
  },
  {
    slug: 'bluthochdruck-tagebuch-hausarzt',
    cluster: 'Herz & Puls',
    h1: 'Bluthochdruck-Tagebuch: Was dein Hausarzt wirklich braucht',
    lede: 'Kein vollgekritzelter Zettel mehr. 7-Tage-Mittel, morgens/abends sauber getrennt, in Sekunden exportiert.',
    persona: 'Herr Becker (67) aus Hannover bringt jetzt ein Blatt mit: Mittel 138/86, morgens höher, abends ruhiger. Sein Arzt stellt die Dosis in 5 Minuten ein — statt 20 Minuten Blättern.',
    problem: 'Einzelwerte in der Praxis sind Zufall (Weißkittel). Ohne Zuhause-Protokoll wird falsch dosiert oder zu spät gehandelt.',
    loesung: [
      'Loggen: Blutdruck, Gewicht, Puls — je 10 Sekunden, mit Zeitstempel. Manschette bleibt, App ersetzt nur den Zettel.',
      'Verbinden: Graph mittelt 7 Tage, trennt Morgen/Abend. Ausreißer nach schlafloser Nacht siehst du sofort.',
      'Handeln: Export als PDF für die Praxis. Beim nächsten Termin legst du es hin — fertig.',
    ],
    preis: 'free-general',
    visual: 'hero-dokumente.svg',
    queries: ['de-blutdruck-app-tagebuch', 'de-bluthochdruck-tagebuch-fuehren'],
    faq: [
      { q: 'Ersetzt das die Manschette?', a: 'Nein. Du misst weiter mit Manschette, HealthGraph ersetzt nur Zettel und Excel.' },
      { q: 'Was sieht der Arzt?', a: 'Mittelwerte, Verlauf, Dosis-Treue. Keine Diagnose von der App — nur ein klarer Spiegel für das Gespräch.' },
    ],
  },
  {
    slug: 'morgen-abend-messung-routine',
    cluster: 'Herz & Puls',
    h1: 'Morgens oder abends messen? Die 19:22-Routine',
    lede: 'Morgens zeigt Erholung, abends zeigt den Tag. So wird aus 2× 60 Sekunden ein Rhythmus, den du nicht vergisst.',
    persona: 'Familie Yilmaz misst abends, während die Nudeln kochen: 19:22, Finger drauf, fertig. Morgens nach dem Aufstehen die zweite Messung. Kein Extra-Termin.',
    problem: 'Unregelmäßig messen bringt Rauschen. Du vergleichst Montagmorgen mit Freitagabend — und wunderst dich.',
    loesung: [
      'Morgens: Nach Aufstehen, vor Kaffee — Erholung pur.',
      'Abends: 19:22-Ritual — Tag steckt noch drin, Pasta-Wasser kocht eh.',
      'Graph: Beide Reihen laufen nebeneinander. Erst dann siehst du: Kurze Nacht → hoher Morgenpuls.',
    ],
    preis: 'general',
    visual: 'hero-tag.svg',
    queries: ['best-time-pulse-reading'],
    faq: [
      { q: 'Reicht einmal am Tag?', a: 'Einmal ist besser als nie. Zweimal baut die Baseline doppelt so schnell.' },
      { q: 'Wie erinnere ich mich?', a: 'Voice-Alarm um 19:22 — du antwortest „gemessen“, es ist geloggt. All-in für Stimme, General für alles andere.' },
    ],
  },
  {
    slug: 'selfie-puls-gesicht-anleitung',
    cluster: 'Herz & Puls',
    h1: 'Selfie-Puls: 30 Sekunden hinschauen, fertig',
    lede: 'Handy aufstellen, 30 Sekunden in die Kamera schauen. Kein Anfassen, kein Licht an der Fingerkuppe — gerechnet wird auf deinem Handy.',
    persona: 'Sabine (52) hat trockene, kalte Finger im Winter — Fingermessung bricht ab. Selfie-Puls am Schreibtisch klappt immer.',
    problem: 'Kalte Finger, zittrige Hände, keine Ruhe? Dann scheitert die Finger-Messung genau dann, wenn du sie willst.',
    loesung: [
      'Aufstellen: Handy anlehnen, Gesicht gut beleuchtet, 30 Sekunden ruhig schauen.',
      'Rechnen: Jedes Frame wird auf deinem Gerät analysiert und sofort vergessen. Nichts lädt hoch.',
      'Nutzen: Gleicher Graph, gleiche Baseline wie Finger-Puls. Du wählst je nach Lage.',
    ],
    preis: 'allin',
    visual: 'hero-puls.svg',
    queries: ['face-pulse-selfie-video', 'de-selfie-puls-gesicht'],
    faq: [
      { q: 'Werden meine Gesichts-Videos gespeichert?', a: 'Nein. Jedes Frame wird analysiert und nie gespeichert. Dein Gesicht verlässt das Handy nicht.' },
      { q: 'In welchem Tarif?', a: 'Face-Puls ist All-in (18 €). Finger-Puls reicht dir? Dann genügt General (11 €).' },
    ],
  },
  {
    slug: 'puls-eltern-senioren-einfach',
    cluster: 'Herz & Puls',
    h1: 'Für Eltern erklärt: Puls messen ohne Technik-Stress',
    lede: 'Kein Pairing, kein Laden, kein Wearable. Einmal zeigen, dann können sie es allein — in 60 Sekunden.',
    persona: 'Tochter Lena hat es ihrem Vater (74) einmal gezeigt: Finger drauf, warten, fertig. Jetzt schickt er ihr sonntags seinen Wochen-Mittelwert.',
    problem: 'Senioren scheitern an Bluetooth, Ladekabeln und 5 Apps. Dann wird gar nicht gemessen — bis der Arzt fragt und niemand etwas weiß.',
    loesung: [
      'Zeigen: 1× gemeinsam messen. Großer Button, große Zahlen, deutsche Sprache.',
      'Lassen: Kein Konto nötig für die Messung, kein Abo-Zwang. Free reicht zum Üben.',
      'Teilen: Beim Familientreffen Wochen-Export zeigen. Oder Family Watch für Medis dazu — du wirst nur informiert, wenn du eingeladen bist.',
    ],
    preis: 'free-general',
    visual: 'hero-vertrauen.svg',
    queries: ['pulse-for-older-parents'],
    faq: [
      { q: 'Können Senioren das allein?', a: 'Ja. 60 Sekunden Finger halten oder 30 Sekunden hinschauen. Kein Pairing, kein Laden.' },
      { q: 'Sieht die Familie alles automatisch?', a: 'Nein. Nie automatisch. Nur was geteilt wird, und bei Medis nur nach deinem Tipp.' },
    ],
  },
  {
    slug: 'smartwatch-vs-handy-puls',
    cluster: 'Herz & Puls',
    h1: 'Smartwatch oder Handy? Ehrlicher Vergleich',
    lede: '300 € Uhr + 10 €/Monat Abo vs. Handy in deiner Tasche für 0 € Start. Wann sich was lohnt.',
    persona: 'Tim (29) trägt Uhr beim Laufen, misst Ruhe aber mit dem Handy. Sein Fazit: Uhr für Intervalle, Handy für Alltag und Schlaf — weil es immer dabei ist.',
    problem: '10 Apps, 10 Abos, keine redet mit der anderen. Du zahlst 48,93 $ im Monat für Chaos (siehe App-Friedhof) und hast trotzdem keinen Gesamtblick.',
    loesung: [
      'Rechnen: Uhr 250 € + Abo 120 €/Jahr = 370 € Jahr 1. HealthGraph Free 0 €, General 132 €/Jahr, alles in einem Graph.',
      'Wählen: Dauerläufer mit Intervallen → Uhr behalten, aber Graph als Zentrale. Alltag ohne Sport → Handy reicht.',
      'Zusammenführen: Wearable-Gäste sind willkommen (Health Connect), aber nie Pflicht.',
    ],
    preis: 'general',
    visual: 'grafik-kosten.svg',
    queries: ['pulse-vs-smartwatch-choice', 'hrv-without-subscription'],
    faq: [
      { q: 'Muss ich meine Uhr wegwerfen?', a: 'Nein. Behalte sie für Sport, nutze HealthGraph als Gedächtnis für alles.' },
      { q: 'Was spare ich wirklich?', a: 'Free 0 € ersetzt Zettel + 3 Apps. General 11 € ersetzt Uhr-Abo + Kalender + Food-App für die meisten.' },
    ],
  },
  {
    slug: 'schlaf-ohne-wearable-tracken',
    cluster: 'Schlaf & Energie',
    h1: 'Schlaf tracken ohne Uhr: Bettzeit + Qualität genügen',
    lede: 'Kein Ring, keine Uhr, kein Laden. Bettzeit, Aufstehzeit, 1 Tipp zur Qualität — die Engine paart Nächte mit Tagen.',
    persona: 'Katrin (41) schläft mit Handy im Flugmodus nebenan. Abends 1 Tipp „23:10 ins Bett“, morgens „6:40 wach, mittel“. Nach 3 Wochen weiß sie: Nach 23:30 wird der nächste Tag schwer.',
    problem: 'Wearables im Bett stören, Akkus sterben nachts, Abos kosten. Also trackst du gar nichts — und wiederholst jede schlechte Woche.',
    loesung: [
      'Tippen: Bettzeit, Wachzeit, Nickerchen, Qualität — je 10 Sekunden.',
      'Paaren: HealthGraph legt Nächte neben Tagesenergie. Deine Formel taucht auf: Welche Bettzeit kauft dir einen guten Morgen?',
      'Schützen: Priority-Engine sagt einen klaren nächsten Schritt: „Heute 22:45, kein Spät-Snack.“',
    ],
    preis: 'free-general',
    visual: 'hero-schlaf.svg',
    queries: ['sleep-without-wearable', 'de-schlaf-tracker-ohne-uhr'],
    faq: [
      { q: 'Ohne Uhr ungenau?', a: 'Für Stadien ja, für Rhythmus nein. Bettzeit + Energie erklären 80 % deines Alltags — ganz ohne Gerät.' },
      { q: 'Wo leben die Daten?', a: 'Zuerst auf deinem Handy. Verschlüsselt, beim Logout gelöscht. Nie verkauft.' },
    ],
  },
  {
    slug: 'muede-trotz-8-stunden-warum',
    cluster: 'Schlaf & Energie',
    h1: 'Müde trotz 8 Stunden? Deine letzten 5 Nächte antworten',
    lede: 'Frag nicht Google, frag deine Nächte. Sanotts KI antwortet aus deinen Logs — mit Beleg, nicht mit Horoskop.',
    persona: 'David (38) schlief 8 Stunden und war trotzdem müde. Der Graph zeigte: 5 kurze Nächte vorher, 3× Spät-Essen. Kein Rätsel mehr.',
    problem: '8 Stunden im Bett ≠ 8 Stunden Schlaf. Alkohol, Spät-Essen, Screen-Time und unregelmäßige Zeiten zerstören Qualität — du siehst es nur nicht.',
    loesung: [
      'Fragen: „Warum bin ich müde?“ — in normalen Worten.',
      'Belegen: KI zitiert deine letzten 5 kurzen Nächte plus Essen/Medis. Kein Internet-Wissen, nur deine Daten.',
      'Ändern: Eine Sache schützen (z. B. 22:45 Bettzeit), 7 Tage halten, Trend prüfen.',
    ],
    preis: 'general',
    visual: 'grafik-naechte.svg',
    queries: ['why-tired-five-short-nights', 'de-warum-muede-trotz-schlaf'],
    faq: [
      { q: 'Ist das eine Diagnose?', a: 'Nein. Wellness-Begleiter, klarer Spiegel, kein Arzt. Bei Schnarchpausen + Tagesmüdigkeit → Hausarzt ansprechen.' },
      { q: 'Sieht die KI alles?', a: 'Nur deine Logs. Sie kann nicht browsen, nicht raten. Fehlt die Datengrundlage, sagt sie es.' },
    ],
  },
];
