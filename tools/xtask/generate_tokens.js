const fs = require('fs');
const path = require('path');

function parseRgb(hex) {
  return [parseInt(hex.slice(1,3), 16), parseInt(hex.slice(3,5), 16), parseInt(hex.slice(5,7), 16)];
}
function lum([r,g,b]) {
  const c = v => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
  return 0.2126*c(r) + 0.7152*c(g) + 0.0722*c(b);
}
function cr(hex1, hex2) {
  const l1 = lum(parseRgb(hex1)), l2 = lum(parseRgb(hex2));
  return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
}

const ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondaryContainer", "onSecondaryContainer", "surface", "surfaceContainerLow",
  "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
  "onSurface", "onSurfaceVariant", "outline", "outlineVariant"
];

function validate(tokens) {
  const bloom = tokens.themes.bloom;
  const status = bloom.status;

  for (const [seed, def] of Object.entries(bloom.seeds)) {
    for (const mode of ["light", "dark"]) {
      checkPalette(def[mode], `bloom.${seed}.${mode}`);
      checkContrast(def[mode], status[mode], `bloom.${seed}.${mode}`);
    }
  }

  for (const theme of ["graphite", "hive"]) {
    const variants = tokens.themes[theme].variants;
    for (const [variant, palette] of Object.entries(variants)) {
      checkPalette(palette, `${theme}.${variant}`);
      checkContrast(palette, palette, `${theme}.${variant}`);
    }
  }
}

function checkPalette(palette, name) {
  for (const role of ROLES) {
    const col = palette[role];
    if (!col || !col.startsWith('#') || col.length !== 7) {
      throw new Error(`${name} missing or invalid ${role}: ${col}`);
    }
  }
}

function checkContrast(palette, status, name) {
  const pairs = [
    ["onPrimary", "primary"],
    ["onPrimaryContainer", "primaryContainer"],
    ["onSecondaryContainer", "secondaryContainer"],
    ["onSurface", "surface"],
    ["onSurfaceVariant", "surface"]
  ];
  for (const [fg, bg] of pairs) {
    const ratio = cr(palette[fg], palette[bg]);
    if (ratio < 4.5) {
      throw new Error(`${name}: ${fg} (${palette[fg]}) on ${bg} (${palette[bg]}) ratio is ${ratio.toFixed(2)} (< 4.5)`);
    }
  }
  if (status.onError && status.error) {
    const errRatio = cr(status.onError, status.error);
    if (errRatio < 4.5) {
      throw new Error(`${name}: onError (${status.onError}) on error (${status.error}) ratio is ${errRatio.toFixed(2)} (< 4.5)`);
    }
  }
}

function stripDocs(val) {
  if (Array.isArray(val)) return val.map(stripDocs);
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (!k.startsWith('$')) out[k] = stripDocs(v);
    }
    return out;
  }
  return val;
}

function renderQml(tokens) {
  const stripped = stripDocs(tokens);
  const data = JSON.stringify(stripped, null, 2).replace(/\n/g, '\n    ');
  return `// SPDX-License-Identifier: GPL-3.0-or-later
// Generated from docs/design/tokens.json by \`cargo xtask tokens\`. Do not edit.
pragma Singleton
import QtQuick

QtObject {
    readonly property var data: (${data})
}
`;
}

function kotlinColor(hex) {
  return `Color(0xFF${hex.replace(/^#/, '').toUpperCase()})`;
}

function kotlinPalette(palette, indent) {
  const pad = " ".repeat(indent);
  const lines = [`Palette(`];
  for (const role of ROLES) {
    lines.push(`${pad}    ${role} = ${kotlinColor(palette[role])},`);
  }
  lines.push(`${pad})`);
  return lines.join('\n');
}

function renderKotlin(tokens) {
  const bloom = tokens.themes.bloom;
  const seeds = bloom.seeds;
  const defaultSeed = bloom.defaultSeed;
  const variants = tokens.themes.graphite.variants;
  const status = bloom.status;
  const statusColor = (mode, key) => kotlinColor(status[mode][key]);

  const out = [
    `// SPDX-License-Identifier: GPL-3.0-or-later`,
    `// Generated from docs/design/tokens.json by \`cargo xtask tokens\`. Do not edit.`,
    `package app.nectarlink.android.ui.theme`,
    ``,
    `import androidx.compose.runtime.Immutable`,
    `import androidx.compose.ui.graphics.Color`,
    ``,
    `/** Material color roles of one theme variant. */`,
    `@Immutable`,
    `data class Palette(`,
  ];
  for (const role of ROLES) {
    out.push(`    val ${role}: Color,`);
  }
  out.push(
    `)`,
    ``,
    `/** A Bloom color preset: its seed swatch and light and dark palettes. */`,
    `@Immutable`,
    `data class Seed(val color: Color, val light: Palette, val dark: Palette)`,
    ``,
    `object Tokens {`,
    `    const val DEFAULT_SEED = "${defaultSeed}"`,
    ``,
    `    val bloomSeeds: Map<String, Seed> = linkedMapOf(`,
  );

  for (const [name, def] of Object.entries(seeds)) {
    out.push(`        "${name}" to Seed(`);
    out.push(`            color = ${kotlinColor(def.seed)},`);
    out.push(`            light = ${kotlinPalette(def.light, 12)},`);
    out.push(`            dark = ${kotlinPalette(def.dark, 12)},`);
    out.push(`        ),`);
  }
  out.push(`    )`);
  out.push(``);
  out.push(`    val graphitePaper = ${kotlinPalette(variants.paper, 4)}`);
  out.push(``);
  out.push(`    val graphiteSlate = ${kotlinPalette(variants.slate, 4)}`);
  out.push(``);
  const hive = tokens.themes.hive.variants;
  out.push(`    val hiveWax = ${kotlinPalette(hive.wax, 4)}`);
  out.push(``);
  out.push(`    val hiveComb = ${kotlinPalette(hive.comb, 4)}`);
  out.push(``);
  for (const [name, mode] of [["Wax", "wax"], ["Comb", "comb"]]) {
    for (const key of ["warning", "error"]) {
      const hex = hive[mode][key];
      const field = `hive${name}${key === 'warning' ? 'Warning' : 'Error'}`;
      out.push(`    val ${field} = ${kotlinColor(hex)}`);
    }
  }
  const comb = tokens.themes.hive.comb;
  out.push(``);
  out.push(`    /** The honeycomb backdrop (themes.hive.comb). */`);
  out.push(`    const val COMB_CELL_DP = ${comb.cell}f`);
  out.push(`    const val COMB_LINE_ALPHA_DARK = ${comb.lineAlphaDark}f`);
  out.push(`    const val COMB_LINE_ALPHA_LIGHT = ${comb.lineAlphaLight}f`);
  out.push(`    const val COMB_GLOW_ALPHA_DARK = ${comb.glowAlphaDark}f`);
  out.push(`    const val COMB_GLOW_ALPHA_LIGHT = ${comb.glowAlphaLight}f`);
  out.push(`    const val COMB_BREATH_SECONDS = ${comb.breathSeconds}f`);
  out.push(`    const val COMB_PULSE_SECONDS = ${comb.pulseSeconds}f`);
  out.push(`    const val COMB_FRAME_MS = ${Math.round(comb.frameMs)}L`);
  out.push(``);
  out.push(`    val warningLight = ${statusColor("light", "warning")}`);
  out.push(`    val warningDark = ${statusColor("dark", "warning")}`);
  out.push(`    val errorLight = ${statusColor("light", "error")}`);
  out.push(`    val errorDark = ${statusColor("dark", "error")}`);
  out.push(`}`);
  out.push(``);

  return out.join('\n');
}

function run() {
  const root = path.resolve(__dirname, '../..');
  const tokensPath = path.join(root, 'docs/design/tokens.json');
  const qmlPath = path.join(root, 'desktop/app/qml/Tokens.qml');
  const kotlinPath = path.join(root, 'android/app/src/main/kotlin/app/nectarlink/android/ui/theme/Tokens.kt');

  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  validate(tokens);
  console.log("Tokens validation passed WCAG 2.1 AA!");

  fs.writeFileSync(qmlPath, renderQml(tokens));
  console.log(`Updated ${qmlPath}`);

  fs.writeFileSync(kotlinPath, renderKotlin(tokens));
  console.log(`Updated ${kotlinPath}`);
}

run();
