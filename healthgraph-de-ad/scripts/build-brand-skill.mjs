/**
 * Builds the `brand-design-md` skill from a checkout of VoltAgent/awesome-design-md.
 *
 * The upstream repo is not a skill repo: it ships 74 brand DESIGN.md files with
 * no SKILL.md and no frontmatter. This wraps them in one skill.
 *
 *   node scripts/build-brand-skill.mjs <path-to-checkout> <path-to-skill-dir>
 *
 * Each brand lands in references/<brand>.md. The SKILL.md stays small on
 * purpose — it holds only an index, so triggering the skill does not pull 2.8 MB
 * of design docs into context. The agent reads the one brand file it needs.
 */
import {cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

const [srcArg, outArg] = process.argv.slice(2);
if (!srcArg || !outArg) {
  console.error("usage: build-brand-skill.mjs <checkout> <out-dir>");
  process.exit(1);
}

const srcDir = resolve(srcArg, "design-md");
const outDir = resolve(outArg);

/**
 * First sentence of the brand's opening section, trimmed to a scannable index
 * line. The repo ships two templates: most use `## Overview`, ten use the
 * numbered `## 1. Visual Theme & Atmosphere`. Both are the "what is this design
 * language" section, so either is a valid source.
 */
const OPEN_SECTIONS = [/^## Overview\s*$/m, /^## 1\. Visual Theme & Atmosphere\s*$/m];

const tagline = (md) => {
  const opener = OPEN_SECTIONS.map((re) => md.split(re)[1]).find(Boolean);
  if (!opener) return "";
  const para = opener
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !p.startsWith("#"));
  if (!para) return "";
  const first = para.split(/(?<=\.)\s/)[0].replace(/\s+/g, " ").trim();
  return first.length > 150 ? `${first.slice(0, 147).trimEnd()}…` : first;
};

const brands = readdirSync(srcDir, {withFileTypes: true})
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

rmSync(join(outDir, "references"), {recursive: true, force: true});
mkdirSync(join(outDir, "references"), {recursive: true});

const index = [];
for (const brand of brands) {
  const md = readFileSync(join(srcDir, brand, "DESIGN.md"), "utf8");
  writeFileSync(join(outDir, "references", `${brand}.md`), md);
  index.push({brand, tagline: tagline(md), bytes: md.length});
}

const lines = [
  "---",
  "name: brand-design-md",
  "description: >",
  "  Apply a real brand's design language to UI work. Use when the user asks to",
  "  build or restyle something that should look like a specific product or company",
  '  (for example "make this feel like Stripe", "Apple-style settings screen",',
  '  "Linear-inspired dashboard", "Supabase-style docs"), or when choosing a',
  "  reference design language for a new surface. Covers 74 brands with analysed",
  "  colour roles, typography scales, layout, elevation, shapes and components.",
  "---",
  "",
  "# Brand design systems (DESIGN.md)",
  "",
  `${brands.length} brand design languages, each in \`references/<brand>.md\`.`,
  "",
  "Upstream: <https://github.com/VoltAgent/awesome-design-md> (CC-licensed analysis",
  "of real product surfaces).",
  "",
  "The files use one of two section templates. Check which one you have before",
  "jumping to a heading:",
  "",
  "- Most files — `Overview` · `Colors` · `Typography` · `Layout` · `Elevation & Depth` ·",
  "  `Shapes` · `Components` · `Do's and Don'ts` · `Responsive Behavior` · `Iteration Guide`",
  "- Ten files (`kraken`, `lamborghini`, `lovable`, `mastercard`, `runwayml`, `sanity`,",
  "  `spotify`, `starbucks`, `tesla`, `theverge`) use the numbered template — `1. Visual",
  "  Theme & Atmosphere` · `2. Color Palette & Roles` · `3. Typography Rules` ·",
  "  `4. Component Stylings` · `5. Layout Principles` · `6. Depth & Elevation` ·",
  "  `7. Do's and Don'ts` · `8. Responsive Behavior` · `9. Agent Prompt Guide`",
  "",
  "## How to use",
  "",
  "1. Find the brand in the index below.",
  "2. **Read only that one file** — e.g. `references/stripe.md`. Do not read the",
  "   whole directory; the point of the index is to keep context small.",
  "3. Lift the actual token values out of the colour and typography sections — hex",
  "  values, type families, weight and tracking — into your own theme. A design",
  "  language applied as vibes produces generic output; applied as tokens it does not.",
  "4. Honour `Do's and Don'ts` and the component section. Those carry the constraints",
  "   that make the result recognisable.",
  "5. If the user named no brand, ask which one, or propose two or three from the",
  "   index that fit the product's tone. Do not silently pick one.",
  "",
  "Treat these as design references, not as brand assets. Do not copy a brand's",
  "logo, wordmark or product screenshots into the output.",
  "",
  "## Index",
  "",
  "| Brand | File | Design language |",
  "| --- | --- | --- |",
  ...index.map(
    ({brand, tagline: t}) =>
      `| \`${brand}\` | \`references/${brand}.md\` | ${t || "_see file_"} |`,
  ),
  "",
];

writeFileSync(join(outDir, "SKILL.md"), lines.join("\n"));

// Keep the vendored originals too, so the skill can be rebuilt or audited.
cpSync(join(srcDir, "..", "LICENSE"), join(outDir, "DESIGN-MD-LICENSE"), {
  force: true,
});

console.log(
  `built ${outDir}\n  brands:  ${brands.length}\n  index:   SKILL.md (${lines.join("\n").length} bytes)\n  payload: references/ ${(index.reduce((a, b) => a + b.bytes, 0) / 1024 / 1024).toFixed(2)} MB`,
);
