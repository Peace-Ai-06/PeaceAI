export const DEFAULT_THEME = {
  mode: 'dark',
  accent: '#7c5cff',
  font: 'system',
  density: 'comfortable',
  sidebar: 'left',
  customCss: '',
};

export const DEFAULT_BRANDING = {
  appName: 'PeaceAi',
  logoText: 'P',
  accent: '#7c5cff',
  tagline: 'Intelligence, in harmony.',
};

const COLOR = /^#[0-9a-fA-F]{3,8}$|^rgb\([\d\s,]+\)$/;

export function sanitizeTheme(input = {}) {
  const theme = { ...DEFAULT_THEME };
  if (['dark', 'light'].includes(input.mode)) theme.mode = input.mode;
  if (COLOR.test(String(input.accent || ''))) theme.accent = String(input.accent);
  if (['system', 'serif', 'mono'].includes(input.font)) theme.font = input.font;
  if (['comfortable', 'compact'].includes(input.density)) theme.density = input.density;
  if (['left', 'right'].includes(input.sidebar)) theme.sidebar = input.sidebar;
  theme.customCss = String(input.customCss || '').replace(/<\/?style[^>]*>/gi, '').replace(/[<>]/g, '').slice(0, 8000);
  return theme;
}

export function sanitizeBranding(input = {}) {
  const branding = { ...DEFAULT_BRANDING };
  for (const key of ['appName', 'logoText', 'tagline']) {
    if (input[key] !== undefined) branding[key] = String(input[key]).replace(/[<>]/g, '').trim().slice(0, 120) || DEFAULT_BRANDING[key];
  }
  if (COLOR.test(String(input.accent || ''))) branding.accent = String(input.accent);
  return branding;
}

export function slugify(value) {
  return String(value || 'workspace').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
}
