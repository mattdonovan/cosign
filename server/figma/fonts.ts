export interface DetectedFont {
  family: string;
  weights: number[];
  isGoogle: boolean;
}

// Weight tokens that appear in Figma reference code, e.g. 'Roboto:Medium'.
const WEIGHT_MAP: Record<string, number> = {
  Thin: 100,
  ExtraLight: 200,
  UltraLight: 200,
  Light: 300,
  Regular: 400,
  Normal: 400,
  Book: 400,
  Medium: 500,
  SemiBold: 600,
  DemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Heavy: 800,
  Black: 900,
};

const WEIGHT_TOKENS = Object.keys(WEIGHT_MAP).join('|');

// Matches `'Roboto:Medium'`, `"Inter:Regular"`, `Open Sans:SemiBold` etc.
const QUOTED_FAMILY = new RegExp(
  `['"]([A-Z][A-Za-z0-9][A-Za-z0-9 _-]{0,40})\\s*:\\s*(${WEIGHT_TOKENS})['"]`,
  'g',
);

// Matches the text-styles footer: family: "Roboto", style: ..., weight: 500
const FAMILY_WEIGHT_PAIR = new RegExp(
  `family:\\s*["']([^"']+)["'][^)]*?weight:\\s*(\\d{3})`,
  'g',
);

// Top ~50 Google Fonts (good enough for v1; refresh from fonts.google.com later).
const GOOGLE_FONTS = new Set<string>([
  'ABeeZee', 'Abril Fatface', 'Alegreya', 'Anton', 'Archivo', 'Arimo',
  'Asap', 'Assistant', 'Barlow', 'Bebas Neue', 'Bitter', 'Cabin', 'Caveat',
  'Crimson Pro', 'Crimson Text', 'DM Mono', 'DM Sans', 'DM Serif Display',
  'EB Garamond', 'Exo 2', 'Figtree', 'Fira Code', 'Fira Mono', 'Fira Sans',
  'Heebo', 'IBM Plex Mono', 'IBM Plex Sans', 'IBM Plex Serif', 'Inconsolata',
  'Inter', 'Inter Tight', 'JetBrains Mono', 'Josefin Sans', 'Karla',
  'Kanit', 'Lato', 'Libre Baskerville', 'Libre Franklin', 'Lora', 'Manrope',
  'Material Icons', 'Merriweather', 'Monoton', 'Montserrat', 'Mulish',
  'Noto Sans', 'Noto Serif', 'Nunito', 'Nunito Sans', 'Open Sans', 'Oswald',
  'Outfit', 'PT Sans', 'PT Serif', 'Pacifico', 'Plus Jakarta Sans',
  'Playfair Display', 'Poppins', 'Public Sans', 'Quicksand', 'Raleway',
  'Roboto', 'Roboto Condensed', 'Roboto Flex', 'Roboto Mono', 'Roboto Serif',
  'Roboto Slab', 'Rubik', 'Source Code Pro', 'Source Sans 3',
  'Source Sans Pro', 'Source Serif Pro', 'Space Grotesk', 'Space Mono',
  'Syne', 'Tinos', 'Titillium Web', 'Ubuntu', 'Ubuntu Mono', 'Urbanist',
  'Vollkorn', 'Work Sans', 'Yanone Kaffeesatz', 'Zilla Slab',
]);

// Strings that look like font names in design-system token paths but aren't
// real font families (e.g. 'Font Family/Brand:Medium'). We drop these.
const FAMILY_BLOCKLIST = new Set<string>([
  'Family', 'Font', 'Font Family', 'Brand', 'Heading', 'Body',
  'Primary', 'Secondary', 'Default', 'Display', 'Text', 'Mono',
]);

export function extractFonts(designContext: string): DetectedFont[] {
  if (!designContext) return [];

  const fontMap = new Map<string, Set<number>>();

  for (const m of designContext.matchAll(QUOTED_FAMILY)) {
    const family = cleanFamily(m[1]);
    if (!family || isBlocked(family)) continue;
    const weight = WEIGHT_MAP[m[2]] ?? 400;
    addWeight(fontMap, family, weight);
  }

  for (const m of designContext.matchAll(FAMILY_WEIGHT_PAIR)) {
    const family = cleanFamily(m[1]);
    if (!family || isBlocked(family)) continue;
    const weight = Number(m[2]);
    if (Number.isFinite(weight)) addWeight(fontMap, family, weight);
  }

  return Array.from(fontMap.entries())
    .map(([family, weights]) => ({
      family,
      weights: Array.from(weights).sort((a, b) => a - b),
      isGoogle: GOOGLE_FONTS.has(family),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

function cleanFamily(raw: string): string {
  // Strip variable-path prefixes like 'Font Family/Brand' → 'Brand'.
  const tail = raw.split('/').pop() ?? raw;
  return tail.trim();
}

function isBlocked(family: string): boolean {
  return FAMILY_BLOCKLIST.has(family);
}

function addWeight(
  map: Map<string, Set<number>>,
  family: string,
  weight: number,
): void {
  const existing = map.get(family) ?? new Set<number>();
  existing.add(weight);
  map.set(family, existing);
}

export function googleFontImport(font: DetectedFont): string {
  const family = font.family.replace(/ /g, '+');
  const weights = font.weights.length > 0 ? font.weights : [400];
  return `@import url('https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(';')}&display=swap');`;
}
