import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://healthgraph.shop';

const src = readFileSync(join(root, 'src/queries.ts'), 'utf8');
const re = /S\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'([^']+)'\s*\)/g;
const queries = [];
let m;
while ((m = re.exec(src))) {
  queries.push({ slug: m[1], q: m[2], a: m[3], section: m[4], lang: 'en' });
}
if (queries.length !== 100) {
  console.error(`Expected 100 queries, found ${queries.length}`);
  process.exit(1);
}

let queriesDe = [];
try {
  const srcDe = readFileSync(join(root, 'src/queries_de.ts'), 'utf8');
  const reDe = new RegExp(re.source, 'g');
  let md;
  while ((md = reDe.exec(srcDe))) {
    queriesDe.push({ slug: 'de-' + md[1], q: md[2], a: md[3], section: md[4], lang: 'de' });
  }
} catch { /* German file optional */ }

const sections = ['home', 'features', 'capabilities', 'app', 'why', 'pricing', 'faq', 'queries', 'about', 'early-access'];
const today = new Date().toISOString().slice(0, 10);

let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
sitemap += `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n`;
for (const s of sections) {
  sitemap += `  <url><loc>${SITE}/#${s}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
}
for (const q of queries) {
  sitemap += `  <url><loc>${SITE}/queries/${q.slug}.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
}
for (const q of queriesDe) {
  sitemap += `  <url><loc>${SITE}/queries/${q.slug}.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
}
sitemap += `</urlset>\n`;
writeFileSync(join(root, 'public/sitemap.xml'), sitemap);

let llms = `# HealthGraph

> HealthGraph connects pulse, sleep, meds, meals, cycle, documents and 3D body into one private on-device health graph. Free to start, free to keep. Wellness companion, not a medical device. No diagnosis, no prescriptions.
> DE: Gesundheit verbunden. Puls per Kamera, Schlaf, Medikamente, Ernährung, Zyklus, Dokumente in einem Graph. DSGVO-konform. 0 € Start.

## Core pages

- [Home](${SITE}/#home): Health, connected. One graph holds it all.
- [Features](${SITE}/#features): Camera pulse, documents, meds, sleep. / Kamera-Puls, Dokumente, Medis, Schlaf.
- [Capabilities](${SITE}/#capabilities): 16 capabilities across Measure, Understand, Manage, Act.
- [App](${SITE}/#app): A day with it, 07:12 to 22:47.
- [Why](${SITE}/#why): 10 apps, 10 subscriptions, none connected. One graph.
- [Pricing](${SITE}/#pricing): Free EUR 0, General EUR 11/mo, All-in EUR 18/mo.
- [FAQ](${SITE}/#faq): Medical device, data home, free tier, wearables, family watch.
- [Answers hub](${SITE}/#queries): 100 EN + ${queriesDe.length} DE questions, each answered from the app.

## 100 landing queries (EN)

`;
for (const q of queries) {
  llms += `- [${q.q}](${SITE}/queries/${q.slug}.html)\n`;
}
llms += `\n## ${queriesDe.length} deutsche Anfragen (DE)\n\n`;
for (const q of queriesDe) {
  llms += `- [${q.q}](${SITE}/queries/${q.slug}.html)\n`;
}
llms += `\n## Data rights\n\n- On-device first, encrypted cache wiped on logout, DSGVO/GDPR aware, export or delete in one tap, never sold.\n`;
writeFileSync(join(root, 'public/llms.txt'), llms);

const qdir = join(root, 'public/queries');
mkdirSync(qdir, { recursive: true });

const page = (title, body, extra = '', lang = 'en') => `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} | HealthGraph</title>
<meta name="description" content="${body.slice(0, 155).replace(/"/g, '&quot;')}" />
<link rel="canonical" href="${SITE}/" />
<meta name="robots" content="index, follow" />
<meta name="geo.region" content="DE" />
</head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6">
<nav><a href="/">HealthGraph</a> / <a href="/queries/">${lang === 'de' ? 'Antworten' : '100 answers'}</a></nav>
<h1>${title}</h1>
<p>${body}</p>
${extra}
<hr />
<p><a href="${SITE}/#early-access">${lang === 'de' ? 'Frühen Zugang sichern — kostenlos starten.' : 'Get early access — free to start, free to keep.'}</a></p>
<p><small>${lang === 'de' ? 'HealthGraph ist ein Wellness-Begleiter, kein Medizinprodukt. Keine Heilaussagen.' : 'HealthGraph is a wellness companion, not a medical device. Nothing here is medical advice.'}</small></p>
</body>
</html>`;

const allQueries = [...queries, ...queriesDe];
for (const q of allQueries) {
  const isDe = q.lang === 'de';
  const html = page(
    q.q,
    q.a,
    `<p><a href="${SITE}/#${q.section}">${isDe ? 'Live-Bereich' : 'See live section'}: #${q.section}</a> · <a href="${SITE}/#queries">${isDe ? 'Alle Antworten' : 'All 100 answers'}</a></p>\n<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } }],
    })}</script>`,
    isDe ? 'de' : 'en',
  );
  writeFileSync(join(qdir, `${q.slug}.html`), html);
}

const hubItemsDe = queriesDe.map((q) => `<li><a href="/queries/${q.slug}.html">${q.q}</a></li>`).join('\n');
const hubItemsEn = queries.map((q) => `<li><a href="/queries/${q.slug}.html">${q.q}</a></li>`).join('\n');
writeFileSync(
  join(qdir, 'index.html'),
  page(
    `${queriesDe.length} deutsche Antworten + ${queries.length} answers | HealthGraph`,
    'Jede deutsche Anfrage landet hier zuerst: Puls, Schlaf, Medis, Ernährung, Arzt, Krankenkasse, DSGVO. / Every English query lands here too.',
    `<h2>Deutsch (${queriesDe.length})</h2>\n<ol>\n${hubItemsDe}\n</ol>\n<h2>English (${queries.length})</h2>\n<ol>\n${hubItemsEn}\n</ol>`,
    '',
    'de',
  ),
);

console.log(`OK: ${queries.length} EN + ${queriesDe.length} DE queries -> sitemap.xml, llms.txt, queries/*.html`);
