import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://healthgraph.shop';
const ART_DIR = join(root, 'public/artikel');
mkdirSync(ART_DIR, { recursive: true });

function parseArtikelFile(path) {
  const src = readFileSync(path, 'utf8');
  const blocks = [];
  // split by slug: entries
  const re = /slug:\s*'([^']+)'[\s\S]*?cluster:\s*'([^']+)'[\s\S]*?h1:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?lede:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?persona:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?problem:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?loesung:\s*\[([\s\S]*?)\][\s\S]*?preis:\s*'([^']+)'[\s\S]*?visual:\s*'([^']+)'[\s\S]*?queries:\s*\[([\s\S]*?)\][\s\S]*?faq:\s*\[([\s\S]*?)\]\s*,?\s*\n\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    const [, slug, cluster, h1, lede, persona, problem, loesungRaw, preis, visual, queriesRaw, faqRaw] = m;
    const strs = (s) => [...s.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
    const loesung = strs(loesungRaw);
    const queries = strs(queriesRaw);
    const faqPairs = [...faqRaw.matchAll(/\{\s*q:\s*'((?:[^'\\]|\\.)*)'\s*,\s*a:\s*'((?:[^'\\]|\\.)*)'\s*\}/g)].map((x) => ({ q: x[1], a: x[2] }));
    blocks.push({ slug, cluster, h1, lede, persona, problem, loesung, preis, visual, queries, faq: faqPairs });
  }
  return blocks;
}

const files = ['artikel_a.ts', 'artikel_b.ts', 'artikel_c.ts', 'artikel_d.ts', 'artikel_e.ts'];
let artikel = [];
for (const f of files) {
  const got = parseArtikelFile(join(root, 'src/artikel', f));
  console.log(f, got.length);
  artikel = artikel.concat(got);
}
console.log('TOTAL', artikel.length);
if (artikel.length !== 50) {
  console.error(`Expected 50 artikel, found ${artikel.length}`);
  process.exit(1);
}

const preisBox = (preis) => {
  if (preis === 'general') return `<div class="preis"><strong>General 11 €/Monat</strong> — Kamera-Puls, Graph, Engines, unlimited Food. Free 0 € reicht zum Starten.</div>`;
  if (preis === 'allin') return `<div class="preis"><strong>All-in 18 €/Monat</strong> — alles aus General + Gesichts-Puls, 3D-Körper, Stimme, unlimited KI/Dokumente. General 11 € als Einstieg.</div>`;
  return `<div class="preis"><strong>Free 0 €</strong> reicht zum Starten (Logging, Medis, Timeline). <strong>General 11 €</strong> wenn Puls/Graph täglich nutzt. <strong>All-in 18 €</strong> für Stimme/3D/unlimited.</div>`;
};

const page = (a) => `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${a.h1} | HealthGraph</title>
<meta name="description" content="${a.lede.slice(0, 155).replace(/"/g, '&quot;')}" />
<link rel="canonical" href="${SITE}/artikel/${a.slug}/" />
<meta name="robots" content="index, follow" />
<meta name="geo.region" content="DE" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${a.h1.replace(/"/g, '&quot;')}" />
<meta property="og:description" content="${a.lede.slice(0, 155).replace(/"/g, '&quot;')}" />
<meta property="og:image" content="${SITE}/artikel/bilder/${a.visual}" />
</head>
<body style="font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 20px 60px;line-height:1.65;background:#050807;color:#fff">
<nav style="margin-bottom:16px"><a style="color:#4fd1c5" href="/">HealthGraph</a> / <a style="color:#4fd1c5" href="/artikel/">Artikel</a> / ${a.cluster}</nav>
<p style="color:#4fd1c5;font-size:13px;letter-spacing:.12em;text-transform:uppercase">${a.cluster} · Deutsch</p>
<h1 style="font-size:clamp(2rem,5vw,3rem);line-height:1.05;letter-spacing:-.02em">${a.h1}</h1>
<p style="font-size:1.15rem;color:#d7e3de">${a.lede}</p>
<img src="/artikel/bilder/${a.visual}" alt="${a.h1.replace(/"/g, '')}" style="width:100%;height:auto;border-radius:20px;margin:16px 0" loading="lazy" />
<h2>Die Geschichte</h2>
<p>${a.persona}</p>
<h2>Das Problem ohne App</h2>
<p>${a.problem}</p>
<h2>So löst du es in 3 Schritten</h2>
<ol>${a.loesung.map((s) => `<li style="margin-bottom:8px">${s}</li>`).join('')}</ol>
${preisBox(a.preis)}
<p style="margin:20px 0"><a href="${SITE}/#early-access" style="display:inline-block;background:#fff;color:#000;padding:12px 26px;border-radius:999px;font-weight:700;text-decoration:none">Frühen Zugang sichern — 0 € Start</a> &nbsp; <a style="color:#4fd1c5" href="${SITE}/#pricing">Preise: 0 € / 11 € / 18 € →</a></p>
<h2>Häufige Fragen</h2>
${a.faq.map((f) => `<h3>${f.q}</h3><p style="color:#d7e3de">${f.a}</p>`).join('')}
<h2>Weiterlesen</h2>
<ul>${a.queries.map((q) => `<li><a style="color:#4fd1c5" href="/queries/${q}.html">${q}</a></li>`).join('')}</ul>
<hr />
<p><small>HealthGraph ist ein Wellness-Begleiter, kein Medizinprodukt. Keine Diagnose, keine Behandlung. Bei klinischen Fragen sprich mit Hausarzt/Ärztin.</small></p>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: a.h1, description: a.lede, inLanguage: 'de', author: { '@type': 'Organization', name: 'HealthGraph' } })}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: a.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) })}</script>
</body>
</html>`;

for (const a of artikel) {
  const dir = join(ART_DIR, a.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(a));
}

// Hub
const hub = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>50 deutsche Gesundheits-Artikel | HealthGraph</title>
<meta name="description" content="50 deutsche Story-Artikel: Puls, Schlaf, Medis, Essen, Dokumente, Zyklus, Preise. Jede Suche landet hier und führt zu 0 € / 11 € / 18 €." />
<link rel="canonical" href="${SITE}/artikel/" /><meta name="robots" content="index, follow" /></head>
<body style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;background:#050807;color:#fff">
<nav><a style="color:#4fd1c5" href="/">HealthGraph</a> / Artikel</nav>
<h1>50 Artikel, die dich überzeugen</h1>
<p>Story statt Q/A. Jeder Artikel endet bei Free 0 €, General 11 € oder All-in 18 € — mit Bildern und Arzt-Export.</p>
<ol>${artikel.map((a) => `<li><a style="color:#4fd1c5" href="/artikel/${a.slug}/">${a.h1}</a> <small>(${a.cluster})</small></li>`).join('\n')}</ol>
<hr /><p><a style="color:#4fd1c5" href="${SITE}/#early-access">Frühen Zugang sichern →</a></p>
</body></html>`;
writeFileSync(join(ART_DIR, 'index.html'), hub);

// Sitemap append
try {
  const smPath = join(root, 'public/sitemap.xml');
  let sm = readFileSync(smPath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const urls = artikel.map((a) => `  <url><loc>${SITE}/artikel/${a.slug}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`).join('\n') + `\n  <url><loc>${SITE}/artikel/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>\n`;
  sm = sm.replace('</urlset>', urls + '</urlset>');
  writeFileSync(smPath, sm);
} catch (e) { console.error('sitemap append failed', e.message); }

console.log(`OK: ${artikel.length} Artikel -> public/artikel/*/ + hub + sitemap`);
