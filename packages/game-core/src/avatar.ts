import type {
  AvatarFeature,
  AvatarInput,
  AvatarPartTransform,
  AvatarSpec,
  LegacyAvatarFeature
} from './types.js';

export interface AvatarPartDefinition {
  id: string;
  label: string;
  unlockId?: string | undefined;
}

const part = (id: string, label: string, unlockId?: string): AvatarPartDefinition => ({ id, label, ...(unlockId ? { unlockId } : {}) });

export const AVATAR_FEATURES: AvatarFeature[] = [
  'face', 'ears', 'hair', 'brows', 'eyes', 'nose', 'mouth', 'facialHair', 'glasses', 'detail', 'accessory'
];

export const AVATAR_PARTS: Record<AvatarFeature, readonly AvatarPartDefinition[]> = {
  face: [part('oval', 'Oval'), part('round', 'Round'), part('square', 'Square'), part('heart', 'Heart'), part('long', 'Long'), part('diamond', 'Diamond')],
  ears: [part('compact', 'Compact'), part('round', 'Round'), part('angled', 'Angled'), part('attached', 'Attached')],
  hair: [
    part('crop', 'Crop'), part('side', 'Side part'), part('wave', 'Wave'), part('curls', 'Curls'), part('buzz', 'Buzz'), part('bald', 'Bald'),
    part('bob', 'Bob'), part('bun', 'Bun'), part('coils', 'Coils'), part('locs', 'Locs', 'avatar-locs'),
    part('undercut', 'Undercut', 'avatar-undercut'), part('swept', 'Swept back', 'avatar-swept-hair')
  ],
  brows: [part('soft', 'Soft'), part('straight', 'Straight'), part('arched', 'Arched'), part('bold', 'Bold'), part('tapered', 'Tapered')],
  eyes: [part('round', 'Round'), part('calm', 'Calm'), part('bright', 'Bright'), part('narrow', 'Narrow'), part('wide', 'Wide'), part('hooded', 'Hooded')],
  nose: [part('small', 'Small'), part('straight', 'Straight'), part('wide', 'Wide'), part('button', 'Button'), part('angular', 'Angular'), part('rounded', 'Rounded')],
  mouth: [part('smile', 'Smile'), part('neutral', 'Neutral'), part('focused', 'Focused'), part('grin', 'Grin'), part('smirk', 'Smirk'), part('soft', 'Soft'), part('frown', 'Frown')],
  facialHair: [
    part('none', 'None'), part('stubble', 'Stubble'), part('goatee', 'Goatee'), part('short-beard', 'Short beard'),
    part('moustache', 'Moustache', 'avatar-moustache'), part('full-beard', 'Full beard', 'avatar-full-beard')
  ],
  glasses: [
    part('none', 'None'), part('square', 'Square'), part('thin', 'Thin'), part('round', 'Round', 'avatar-round-glasses'),
    part('browline', 'Browline', 'avatar-browline-glasses'), part('sport', 'Sport', 'avatar-sport-glasses')
  ],
  detail: [
    part('none', 'None'), part('freckles', 'Freckles'), part('mole', 'Mole'), part('blush', 'Blush'),
    part('under-eye', 'Under-eye lines'), part('cut', 'Cut', 'avatar-cut-mark')
  ],
  accessory: [
    part('none', 'None'), part('stud', 'Stud'), part('hoop', 'Hoop', 'avatar-hoop-earring'),
    part('double-stud', 'Double stud', 'avatar-double-stud')
  ]
};

export const AVATAR_PALETTES = {
  skinTone: ['#f8dfcb', '#f6d2b8', '#e8b98f', '#d9a074', '#ca8d62', '#b97850', '#9b6040', '#805039', '#6d402c', '#563124', '#3d241b', '#2b1914'],
  hairColor: ['#171312', '#2a1b17', '#4a2d1d', '#694127', '#8a5b34', '#b47a45', '#c7a269', '#d9c4a0', '#8b8e8c', '#332a4f'],
  browColor: ['#171312', '#2a1b17', '#4a2d1d', '#694127', '#8a5b34', '#b47a45', '#8b8e8c', '#332a4f'],
  eyeColor: ['#34241d', '#59402d', '#315d62', '#43777b', '#546b35', '#718548', '#283e64', '#536f9f', '#6f5946', '#303335'],
  mouthColor: ['#7d3f3d', '#9f554d', '#b66c66', '#c68176', '#8a4d57', '#6e3b45', '#b05d4c', '#744445'],
  glassesColor: ['#161b1a', '#333a38', '#6f756f', '#a98648', '#8e553b', '#315d62', '#3d456b', '#7b3948'],
  detailColor: ['#8f4a3b', '#a75c4c', '#704037', '#bd7469', '#744a3e', '#57332d'],
  accessoryColor: ['#d8c7a0', '#d3ae5b', '#aeb7b4', '#835238', '#315d62', '#4d557b', '#8b4353', '#252b29'],
  backgroundColor: ['#173f32', '#1e4b43', '#1d3b54', '#3e3150', '#5a342f', '#564823', '#263632', '#192521']
} as const;

export type AvatarColorField = keyof typeof AVATAR_PALETTES;
export const AVATAR_COLOR_FIELDS = Object.keys(AVATAR_PALETTES) as AvatarColorField[];

export const DEFAULT_AVATAR_TRANSFORM: AvatarPartTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
export const AVATAR_TRANSFORM_LIMITS = { position: 20, minimumScale: 0.65, maximumScale: 1.4, rotation: 30 } as const;

const LEGACY_PARTS: Record<LegacyAvatarFeature, readonly string[]> = {
  face: ['oval', 'round', 'square', 'heart'], hair: ['crop', 'side', 'wave', 'curls', 'buzz', 'bald'],
  brows: ['soft', 'straight', 'arched'], eyes: ['round', 'calm', 'bright'], nose: ['small', 'straight', 'wide'],
  mouth: ['smile', 'neutral', 'focused'], facialHair: ['none', 'beard'], glasses: ['none', 'round'], mark: ['none', 'cut']
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function knownPart(feature: AvatarFeature, value: unknown, fallback: string): string {
  return typeof value === 'string' && AVATAR_PARTS[feature].some((entry) => entry.id === value) ? value : fallback;
}

function validTransform(value: unknown): value is AvatarPartTransform {
  const candidate = record(value);
  return Boolean(candidate
    && Number.isFinite(candidate.x) && Math.abs(candidate.x as number) <= AVATAR_TRANSFORM_LIMITS.position
    && Number.isFinite(candidate.y) && Math.abs(candidate.y as number) <= AVATAR_TRANSFORM_LIMITS.position
    && Number.isFinite(candidate.scale) && (candidate.scale as number) >= AVATAR_TRANSFORM_LIMITS.minimumScale && (candidate.scale as number) <= AVATAR_TRANSFORM_LIMITS.maximumScale
    && Number.isFinite(candidate.rotation) && Math.abs(candidate.rotation as number) <= AVATAR_TRANSFORM_LIMITS.rotation);
}

function normalizeTransforms(value: unknown, legacy = false): AvatarSpec['transforms'] {
  const source = record(value);
  if (!source) return {};
  const result: AvatarSpec['transforms'] = {};
  for (const [sourceFeature, transform] of Object.entries(source)) {
    const feature = legacy && sourceFeature === 'mark' ? 'detail' : sourceFeature as AvatarFeature;
    if (!AVATAR_FEATURES.includes(feature) || !validTransform(transform)) continue;
    result[feature] = { x: transform.x, y: transform.y, scale: transform.scale, rotation: transform.rotation };
  }
  return result;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash;
}

export function avatarPartUnlockId(feature: AvatarFeature, partId: string): string | null {
  return AVATAR_PARTS[feature].find((entry) => entry.id === partId)?.unlockId ?? null;
}

export function availableAvatarParts(feature: AvatarFeature, unlocks: Iterable<string>): AvatarPartDefinition[] {
  const owned = new Set(unlocks);
  return AVATAR_PARTS[feature].filter((entry) => !entry.unlockId || owned.has(entry.unlockId));
}

export function avatarUnlockRequirements(avatar: AvatarSpec): string[] {
  return [...new Set(AVATAR_FEATURES.flatMap((feature) => {
    const unlockId = avatarPartUnlockId(feature, avatar[feature]);
    return unlockId ? [unlockId] : [];
  }))];
}

export function defaultAvatar(seed = ''): AvatarSpec {
  const hash = hashSeed(seed);
  const pick = <T>(values: readonly T[], offset: number): T => values[Math.abs(hash + offset) % values.length]!;
  const basePart = (feature: AvatarFeature, offset: number) => pick(AVATAR_PARTS[feature].filter((entry) => !entry.unlockId), offset).id;
  const hairColor = pick(AVATAR_PALETTES.hairColor, 4);
  return {
    version: 2,
    skinTone: pick(AVATAR_PALETTES.skinTone, 1), face: basePart('face', 2), ears: basePart('ears', 3),
    hair: basePart('hair', 4), hairColor, brows: basePart('brows', 5), browColor: hairColor,
    eyes: basePart('eyes', 6), eyeColor: pick(AVATAR_PALETTES.eyeColor, 7), nose: basePart('nose', 8),
    mouth: basePart('mouth', 9), mouthColor: pick(AVATAR_PALETTES.mouthColor, 10),
    facialHair: 'none', glasses: 'none', glassesColor: '#161b1a', detail: 'none', detailColor: '#8f4a3b',
    accessory: 'none', accessoryColor: '#d3ae5b', backgroundColor: pick(AVATAR_PALETTES.backgroundColor, 11), transforms: {}
  };
}

function migrateLegacy(value: Record<string, unknown>, seed: string): AvatarSpec {
  const fallback = defaultAvatar(seed);
  const legacyPart = (feature: LegacyAvatarFeature, fallbackValue: string): string => (
    typeof value[feature] === 'string' && LEGACY_PARTS[feature].includes(value[feature] as string) ? value[feature] as string : fallbackValue
  );
  return {
    ...fallback,
    skinTone: color(value.skinTone, fallback.skinTone), face: legacyPart('face', fallback.face), hair: legacyPart('hair', fallback.hair),
    hairColor: color(value.hairColor, fallback.hairColor), brows: legacyPart('brows', fallback.brows), browColor: color(value.browColor, fallback.browColor),
    eyes: legacyPart('eyes', fallback.eyes), eyeColor: color(value.eyeColor, fallback.eyeColor), nose: legacyPart('nose', fallback.nose),
    mouth: legacyPart('mouth', fallback.mouth), mouthColor: color(value.mouthColor, fallback.mouthColor),
    facialHair: legacyPart('facialHair', 'none') === 'beard' ? 'short-beard' : 'none',
    glasses: legacyPart('glasses', 'none'), detail: legacyPart('mark', 'none'), transforms: normalizeTransforms(value.transforms, true)
  };
}

export function normalizeAvatar(value: unknown, seed = ''): AvatarSpec {
  const source = record(value);
  const fallback = defaultAvatar(seed);
  if (!source) return fallback;
  if (source.version === 1) return migrateLegacy(source, seed);
  if (source.version !== 2) return fallback;
  return {
    version: 2,
    skinTone: color(source.skinTone, fallback.skinTone), face: knownPart('face', source.face, fallback.face), ears: knownPart('ears', source.ears, fallback.ears),
    hair: knownPart('hair', source.hair, fallback.hair), hairColor: color(source.hairColor, fallback.hairColor),
    brows: knownPart('brows', source.brows, fallback.brows), browColor: color(source.browColor, fallback.browColor),
    eyes: knownPart('eyes', source.eyes, fallback.eyes), eyeColor: color(source.eyeColor, fallback.eyeColor),
    nose: knownPart('nose', source.nose, fallback.nose), mouth: knownPart('mouth', source.mouth, fallback.mouth), mouthColor: color(source.mouthColor, fallback.mouthColor),
    facialHair: knownPart('facialHair', source.facialHair, fallback.facialHair), glasses: knownPart('glasses', source.glasses, fallback.glasses),
    glassesColor: color(source.glassesColor, fallback.glassesColor), detail: knownPart('detail', source.detail, fallback.detail),
    detailColor: color(source.detailColor, fallback.detailColor), accessory: knownPart('accessory', source.accessory, fallback.accessory),
    accessoryColor: color(source.accessoryColor, fallback.accessoryColor), backgroundColor: color(source.backgroundColor, fallback.backgroundColor),
    transforms: normalizeTransforms(source.transforms)
  };
}

function strictParts(source: Record<string, unknown>, version: 1 | 2): boolean {
  if (version === 1) return (Object.keys(LEGACY_PARTS) as LegacyAvatarFeature[])
    .every((feature) => typeof source[feature] === 'string' && LEGACY_PARTS[feature].includes(source[feature] as string));
  return AVATAR_FEATURES.every((feature) => typeof source[feature] === 'string'
    && AVATAR_PARTS[feature].some((entry) => entry.id === source[feature]));
}

export function validAvatar(value: unknown): value is AvatarInput {
  const source = record(value);
  if (!source || (source.version !== 1 && source.version !== 2) || !strictParts(source, source.version)) return false;
  const colorFields = source.version === 1
    ? ['skinTone', 'hairColor', 'browColor', 'eyeColor', 'mouthColor']
    : AVATAR_COLOR_FIELDS;
  if (!colorFields.every((field) => typeof source[field] === 'string' && /^#[0-9a-f]{6}$/i.test(source[field] as string))) return false;
  const transforms = record(source.transforms);
  if (!transforms) return false;
  const validFeatures = source.version === 1 ? Object.keys(LEGACY_PARTS) : AVATAR_FEATURES;
  return Object.entries(transforms).every(([feature, transform]) => validFeatures.includes(feature) && validTransform(transform));
}

export function avatarOwned(avatar: AvatarSpec, unlocks: Iterable<string>): boolean {
  const owned = new Set(unlocks);
  return avatarUnlockRequirements(avatar).every((unlockId) => owned.has(unlockId));
}
