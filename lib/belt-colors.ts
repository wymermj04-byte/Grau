export type BeltColorProfile = {
  primaryColor: string;
  secondaryColor?: string;
  borderColor: string;
  textColor: string;
};

export type NeutralBeltColors = BeltColorProfile;

const DARK_TEXT = '#1A1D1C';
const LIGHT_TEXT = '#F7F5EF';

const BELT_COLORS: Record<string, BeltColorProfile> = {
  white: { primaryColor: '#F5F1E8', borderColor: '#AAA59C', textColor: DARK_TEXT },
  'white belt': { primaryColor: '#F5F1E8', borderColor: '#AAA59C', textColor: DARK_TEXT },
  blue: { primaryColor: '#2369AC', borderColor: '#13416C', textColor: LIGHT_TEXT },
  purple: { primaryColor: '#6C468B', borderColor: '#422B57', textColor: LIGHT_TEXT },
  brown: { primaryColor: '#704831', borderColor: '#432919', textColor: LIGHT_TEXT },
  black: { primaryColor: '#202326', borderColor: '#07090A', textColor: LIGHT_TEXT },
  grey: { primaryColor: '#92989B', borderColor: '#62696D', textColor: DARK_TEXT },
  gray: { primaryColor: '#92989B', borderColor: '#62696D', textColor: DARK_TEXT },
  yellow: { primaryColor: '#E2BC35', borderColor: '#9A7815', textColor: DARK_TEXT },
  orange: { primaryColor: '#D87332', borderColor: '#91421A', textColor: DARK_TEXT },
  green: { primaryColor: '#4E8758', borderColor: '#2D5634', textColor: LIGHT_TEXT },
  'grey/white': { primaryColor: '#92989B', secondaryColor: '#F5F1E8', borderColor: '#62696D', textColor: DARK_TEXT },
  'gray/white': { primaryColor: '#92989B', secondaryColor: '#F5F1E8', borderColor: '#62696D', textColor: DARK_TEXT },
  'white/grey': { primaryColor: '#F5F1E8', secondaryColor: '#92989B', borderColor: '#AAA59C', textColor: DARK_TEXT },
  'white/gray': { primaryColor: '#F5F1E8', secondaryColor: '#92989B', borderColor: '#AAA59C', textColor: DARK_TEXT },
  'grey/black': { primaryColor: '#92989B', secondaryColor: '#202326', borderColor: '#62696D', textColor: DARK_TEXT },
  'gray/black': { primaryColor: '#92989B', secondaryColor: '#202326', borderColor: '#62696D', textColor: DARK_TEXT },
  'black/grey': { primaryColor: '#202326', secondaryColor: '#92989B', borderColor: '#07090A', textColor: LIGHT_TEXT },
  'black/gray': { primaryColor: '#202326', secondaryColor: '#92989B', borderColor: '#07090A', textColor: LIGHT_TEXT },
  'yellow/white': { primaryColor: '#E2BC35', secondaryColor: '#F5F1E8', borderColor: '#9A7815', textColor: DARK_TEXT },
  'white/yellow': { primaryColor: '#F5F1E8', secondaryColor: '#E2BC35', borderColor: '#AAA59C', textColor: DARK_TEXT },
  'yellow/black': { primaryColor: '#E2BC35', secondaryColor: '#202326', borderColor: '#9A7815', textColor: DARK_TEXT },
  'black/yellow': { primaryColor: '#202326', secondaryColor: '#E2BC35', borderColor: '#07090A', textColor: LIGHT_TEXT },
  'orange/white': { primaryColor: '#D87332', secondaryColor: '#F5F1E8', borderColor: '#91421A', textColor: DARK_TEXT },
  'white/orange': { primaryColor: '#F5F1E8', secondaryColor: '#D87332', borderColor: '#AAA59C', textColor: DARK_TEXT },
  'orange/black': { primaryColor: '#D87332', secondaryColor: '#202326', borderColor: '#91421A', textColor: DARK_TEXT },
  'black/orange': { primaryColor: '#202326', secondaryColor: '#D87332', borderColor: '#07090A', textColor: LIGHT_TEXT },
  'green/white': { primaryColor: '#4E8758', secondaryColor: '#F5F1E8', borderColor: '#2D5634', textColor: LIGHT_TEXT },
  'white/green': { primaryColor: '#F5F1E8', secondaryColor: '#4E8758', borderColor: '#AAA59C', textColor: DARK_TEXT },
  'green/black': { primaryColor: '#4E8758', secondaryColor: '#202326', borderColor: '#2D5634', textColor: LIGHT_TEXT },
  'black/green': { primaryColor: '#202326', secondaryColor: '#4E8758', borderColor: '#07090A', textColor: LIGHT_TEXT },
};

function normalizeBeltRank(rank: string | null | undefined) {
  return rank?.trim().toLocaleLowerCase().replace(/\s*\/\s*/g, '/') ?? '';
}

export function getBeltColorProfile(rank: string | null | undefined, fallback: NeutralBeltColors): BeltColorProfile {
  return BELT_COLORS[normalizeBeltRank(rank)] ?? fallback;
}
