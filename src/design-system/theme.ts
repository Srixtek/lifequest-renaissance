/** Eloria visual tokens — forest night + amber ember (avoid purple / cream-terracotta clusters). */
export const colors = {
  bg: '#0B1C1A',
  bgElevated: '#12302B',
  mist: '#1A3F3A',
  ink: '#E7F2EE',
  muted: '#9BB5AD',
  ember: '#E0A45A',
  emberDim: '#B8792E',
  success: '#5FAF7A',
  warn: '#D4A017',
  danger: '#C75C5C',
  line: '#2A4A44',
  card: '#102824',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const typography = {
  brand: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
};
