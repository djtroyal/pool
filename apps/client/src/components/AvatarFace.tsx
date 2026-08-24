import { normalizeAvatar, type AvatarFeature, type AvatarInput, type AvatarPartTransform, type RankTier } from '@breakroom/game-core';
import type { CSSProperties } from 'react';

interface AvatarFaceProps {
  avatar: AvatarInput;
  rank?: RankTier | undefined;
  active?: boolean;
  size?: 'small' | 'medium' | 'large' | 'studio';
  className?: string;
  decorative?: boolean;
}

const FACE_PATHS: Record<string, string> = {
  oval: 'M50 9 Q83 12 79 50 Q75 88 50 93 Q25 88 21 50 Q17 12 50 9Z',
  round: 'M50 12 A37 37 0 1 1 49.9 12Z',
  square: 'M21 23 Q50 10 79 23 L76 73 Q50 94 24 73Z',
  heart: 'M18 25 Q50 3 82 25 Q80 68 50 88 Q20 68 18 25Z',
  long: 'M50 7 Q80 10 77 48 Q74 92 50 97 Q26 92 23 48 Q20 10 50 7Z',
  diamond: 'M50 8 Q75 15 83 45 Q74 79 50 94 Q26 79 17 45 Q25 15 50 8Z'
};

type NormalizedAvatar = ReturnType<typeof normalizeAvatar>;

function featureTransform(avatar: NormalizedAvatar, feature: AvatarFeature): string | undefined {
  const value: AvatarPartTransform | undefined = avatar.transforms[feature];
  return value
    ? `translate(${value.x} ${value.y}) rotate(${value.rotation} 50 50) translate(50 50) scale(${value.scale}) translate(-50 -50)`
    : undefined;
}

function EarLayer({ avatar }: { avatar: NormalizedAvatar }) {
  const shape = avatar.ears === 'compact' ? { rx: 5, ry: 10, cy: 52 }
    : avatar.ears === 'angled' ? { rx: 6, ry: 13, cy: 50 }
      : avatar.ears === 'attached' ? { rx: 5, ry: 9, cy: 56 } : { rx: 7, ry: 12, cy: 52 };
  return <g transform={featureTransform(avatar, 'ears')} fill={avatar.skinTone} stroke="rgba(68,34,24,.28)" strokeWidth="1.4">
    <ellipse cx="19" cy={shape.cy} rx={shape.rx} ry={shape.ry} /><ellipse cx="81" cy={shape.cy} rx={shape.rx} ry={shape.ry} />
    <path d={`M19 ${shape.cy - 4} Q15 ${shape.cy} 19 ${shape.cy + 5} M81 ${shape.cy - 4} Q85 ${shape.cy} 81 ${shape.cy + 5}`} fill="none" opacity=".48" />
  </g>;
}

function HairBack({ avatar }: { avatar: NormalizedAvatar }) {
  const common = { fill: avatar.hairColor, opacity: .98 };
  if (avatar.hair === 'bob') return <path {...common} d="M16 30 Q18 4 50 5 Q82 4 84 31 L82 76 Q72 86 67 73 L70 31 L30 31 L33 74 Q25 86 18 75Z" />;
  if (avatar.hair === 'bun') return <g {...common}><circle cx="72" cy="14" r="14" /><path d="M19 35 Q20 5 51 7 Q80 8 81 38 L73 32 Q50 20 27 35Z" /></g>;
  if (avatar.hair === 'locs') return <g {...common}><path d="M18 35 Q18 5 50 6 Q82 5 82 36 Q77 28 69 24 Q50 17 29 29Z" />{[22,28,34,66,72,78].map((x) => <path d={`M${x} 25 Q${x - 4} 54 ${x + (x < 50 ? -1 : 1)} 82`} fill="none" stroke={avatar.hairColor} strokeWidth="6" strokeLinecap="round" key={x} />)}</g>;
  if (avatar.hair === 'curls' || avatar.hair === 'coils') return <path {...common} d="M15 37 Q9 24 21 19 Q19 6 35 11 Q45 -1 56 10 Q73 3 75 19 Q88 20 82 39 Q70 25 50 25 Q30 24 15 37Z" />;
  return null;
}

function HairFront({ avatar }: { avatar: NormalizedAvatar }) {
  if (avatar.hair === 'bald' || avatar.hair === 'bob' || avatar.hair === 'locs') return null;
  const paths: Record<string, string> = {
    crop: 'M20 34 Q23 7 51 9 Q78 9 80 35 Q53 18 20 34Z',
    side: 'M18 38 Q18 8 53 8 Q81 9 82 37 Q57 12 18 38Z',
    wave: 'M18 37 Q19 7 52 8 Q84 8 82 39 Q69 21 53 27 Q37 14 18 37Z',
    buzz: 'M20 34 Q24 8 50 8 Q77 8 81 34 Q62 23 20 34Z',
    bun: 'M19 36 Q20 6 51 8 Q78 9 81 38 Q61 20 25 35Z',
    undercut: 'M22 30 Q30 7 58 9 Q78 10 82 31 Q62 16 41 25 Q31 28 22 30Z',
    swept: 'M18 36 Q21 8 52 7 Q81 7 84 35 Q68 17 30 30 Q25 32 18 36Z'
  };
  if (avatar.hair === 'curls' || avatar.hair === 'coils') {
    const points = avatar.hair === 'coils' ? [[24,26],[34,19],[45,22],[56,18],[67,22],[76,29]] : [[22,27],[34,18],[47,21],[59,16],[72,24],[80,32]];
    return <g fill={avatar.hairColor}>{points.map(([x,y], index) => <circle cx={x} cy={y} r={avatar.hair === 'coils' ? 8 : 9} key={index} />)}</g>;
  }
  return <path fill={avatar.hairColor} d={paths[avatar.hair] ?? paths.crop} />;
}

function Brows({ avatar }: { avatar: NormalizedAvatar }) {
  const width = avatar.brows === 'bold' ? 4.6 : avatar.brows === 'soft' ? 2.5 : 3.2;
  const left = avatar.brows === 'arched' ? 'M28 42 Q36 34 43 41'
    : avatar.brows === 'tapered' ? 'M27 41 Q36 38 44 41' : avatar.brows === 'soft' ? 'M28 42 Q35 39 43 41' : 'M28 41 L43 40';
  const right = avatar.brows === 'arched' ? 'M57 41 Q65 34 73 42'
    : avatar.brows === 'tapered' ? 'M56 41 Q65 38 73 41' : avatar.brows === 'soft' ? 'M57 41 Q65 39 72 42' : 'M57 40 L72 41';
  return <g transform={featureTransform(avatar, 'brows')} stroke={avatar.browColor} strokeWidth={width} strokeLinecap="round" fill="none"><path d={left} /><path d={right} /></g>;
}

function Eyes({ avatar }: { avatar: NormalizedAvatar }) {
  const dimensions: Record<string, [number, number]> = { round: [6,5], calm: [7,3], bright: [6.5,5.5], narrow: [7,2.4], wide: [8,5.2], hooded: [7,3.8] };
  const [rx, ry] = dimensions[avatar.eyes] ?? dimensions.round!;
  return <g transform={featureTransform(avatar, 'eyes')}>
    <g fill="#f8f6eb" stroke="rgba(0,0,0,.3)" strokeWidth="1"><ellipse cx="36" cy="49" rx={rx} ry={ry} /><ellipse cx="64" cy="49" rx={rx} ry={ry} /></g>
    <g fill={avatar.eyeColor}><circle cx="36" cy="49" r={avatar.eyes === 'wide' ? 2.8 : 2.4} /><circle cx="64" cy="49" r={avatar.eyes === 'wide' ? 2.8 : 2.4} /></g>
    <g fill="#101412"><circle cx="36" cy="49" r="1.15" /><circle cx="64" cy="49" r="1.15" /></g>
    {avatar.eyes === 'hooded' && <g fill="none" stroke="rgba(64,35,28,.38)" strokeWidth="1.4"><path d="M29 47 Q36 43 43 47"/><path d="M57 47 Q64 43 71 47"/></g>}
  </g>;
}

function Nose({ avatar }: { avatar: NormalizedAvatar }) {
  const paths: Record<string, string> = {
    wide: 'M43 61 Q50 66 57 61', straight: 'M50 50 L48 62 Q51 65 55 62', small: 'M47 61 Q50 64 53 61',
    button: 'M46 60 Q50 66 54 60 Q50 63 46 60', angular: 'M51 50 L46 62 L54 64', rounded: 'M46 60 Q50 66 56 61'
  };
  return <path transform={featureTransform(avatar, 'nose')} d={paths[avatar.nose] ?? paths.small} fill="none" stroke="rgba(70,35,25,.44)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
}

function Mouth({ avatar }: { avatar: NormalizedAvatar }) {
  const paths: Record<string, string> = {
    smile: 'M39 72 Q50 81 62 71', neutral: 'M41 73 L59 73', focused: 'M41 73 Q50 69 59 73',
    grin: 'M37 71 Q50 84 64 70 Q51 77 37 71Z', smirk: 'M40 73 Q52 77 61 69', soft: 'M40 72 Q50 76 60 72', frown: 'M40 76 Q50 68 60 76'
  };
  const filled = avatar.mouth === 'grin';
  return <path transform={featureTransform(avatar, 'mouth')} d={paths[avatar.mouth] ?? paths.neutral} fill={filled ? '#f4eee5' : 'none'} stroke={avatar.mouthColor} strokeWidth={filled ? 2 : 3} strokeLinecap="round" strokeLinejoin="round" />;
}

function FaceDetail({ avatar }: { avatar: NormalizedAvatar }) {
  const transform = featureTransform(avatar, 'detail');
  if (avatar.detail === 'freckles') return <g transform={transform} fill={avatar.detailColor} opacity=".7">{[[32,59],[38,61],[43,59],[58,59],[64,61],[69,58]].map(([x,y], index) => <circle cx={x} cy={y} r="1" key={index}/>)}</g>;
  if (avatar.detail === 'mole') return <circle transform={transform} cx="68" cy="62" r="1.6" fill={avatar.detailColor} />;
  if (avatar.detail === 'blush') return <g transform={transform} fill={avatar.detailColor} opacity=".18"><ellipse cx="31" cy="62" rx="9" ry="4"/><ellipse cx="69" cy="62" rx="9" ry="4"/></g>;
  if (avatar.detail === 'under-eye') return <g transform={transform} fill="none" stroke={avatar.detailColor} opacity=".38" strokeWidth="1"><path d="M29 55 Q36 58 43 55"/><path d="M57 55 Q64 58 71 55"/></g>;
  if (avatar.detail === 'cut') return <path transform={transform} d="M68 58 l8 9 M70 56 l8 9" stroke={avatar.detailColor} strokeWidth="1.8" strokeLinecap="round" />;
  return null;
}

function FacialHair({ avatar }: { avatar: NormalizedAvatar }) {
  const transform = featureTransform(avatar, 'facialHair');
  if (avatar.facialHair === 'none') return null;
  if (avatar.facialHair === 'stubble') return <path transform={transform} d="M33 67 Q36 88 50 91 Q64 88 67 67 Q59 78 50 80 Q41 78 33 67Z" fill={avatar.hairColor} opacity=".25" />;
  if (avatar.facialHair === 'moustache') return <path transform={transform} d="M49 67 Q42 62 37 68 Q43 74 50 69 Q57 74 64 68 Q58 62 51 67Z" fill={avatar.hairColor} opacity=".9" />;
  if (avatar.facialHair === 'goatee') return <g transform={transform} fill={avatar.hairColor} opacity=".88"><path d="M42 68 Q50 74 58 68 Q54 72 50 72 Q46 72 42 68Z"/><path d="M44 78 Q50 92 56 78 Q53 91 50 93 Q47 91 44 78Z"/></g>;
  const full = avatar.facialHair === 'full-beard';
  return <path transform={transform} d={full ? 'M27 59 Q28 88 50 98 Q72 88 73 59 Q65 72 61 80 Q50 88 39 80 Q34 70 27 59Z' : 'M34 67 Q35 88 50 94 Q65 88 66 67 Q61 78 50 84 Q39 78 34 67Z'} fill={avatar.hairColor} opacity={full ? .94 : .82} />;
}

function Glasses({ avatar }: { avatar: NormalizedAvatar }) {
  if (avatar.glasses === 'none') return null;
  const transform = featureTransform(avatar, 'glasses');
  const common = { fill: 'none', stroke: avatar.glassesColor, strokeWidth: avatar.glasses === 'thin' ? 1.3 : 2.1 };
  if (avatar.glasses === 'round') return <g transform={transform} {...common}><circle cx="36" cy="50" r="10"/><circle cx="64" cy="50" r="10"/><path d="M46 49 L54 49 M26 48 L19 45 M74 48 L81 45"/></g>;
  if (avatar.glasses === 'sport') return <g transform={transform} {...common}><path d="M24 45 Q35 40 47 46 L43 55 Q33 59 25 52Z M53 46 Q65 40 76 45 L75 52 Q67 59 57 55Z M47 47 L53 47" fill={avatar.glassesColor} opacity=".42" /></g>;
  const browline = avatar.glasses === 'browline';
  return <g transform={transform} {...common}><rect x="25" y="42" width="22" height="16" rx={avatar.glasses === 'thin' ? 7 : 3}/><rect x="53" y="42" width="22" height="16" rx={avatar.glasses === 'thin' ? 7 : 3}/><path d="M47 48 L53 48 M25 47 L19 44 M75 47 L81 44"/>{browline && <path d="M25 43 Q36 38 47 43 M53 43 Q64 38 75 43" strokeWidth="4"/>}</g>;
}

function Accessory({ avatar }: { avatar: NormalizedAvatar }) {
  const transform = featureTransform(avatar, 'accessory');
  if (avatar.accessory === 'stud') return <circle transform={transform} cx="82" cy="61" r="2.5" fill={avatar.accessoryColor} stroke="rgba(255,255,255,.45)" strokeWidth=".7" />;
  if (avatar.accessory === 'hoop') return <circle transform={transform} cx="82" cy="64" r="5" fill="none" stroke={avatar.accessoryColor} strokeWidth="2" />;
  if (avatar.accessory === 'double-stud') return <g transform={transform} fill={avatar.accessoryColor}><circle cx="82" cy="58" r="2"/><circle cx="83" cy="65" r="2.4"/></g>;
  return null;
}

export function AvatarFace({ avatar: input, rank, active = false, size = 'medium', className = '', decorative = false }: AvatarFaceProps) {
  const avatar = normalizeAvatar(input);
  const style = { '--avatar-background': avatar.backgroundColor } as CSSProperties;
  return <span className={`avatar-face avatar-${size} ${active ? 'active' : ''} ${className}`} style={style}>
    <svg viewBox="0 0 100 100" {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Player avatar' })}>
      <g transform={featureTransform(avatar, 'hair')}><HairBack avatar={avatar} /></g>
      <EarLayer avatar={avatar} />
      <path d={FACE_PATHS[avatar.face] ?? FACE_PATHS.oval} fill={avatar.skinTone} stroke="rgba(255,255,255,.18)" strokeWidth="2" transform={featureTransform(avatar, 'face')} />
      <FaceDetail avatar={avatar} />
      <Brows avatar={avatar} />
      <Eyes avatar={avatar} />
      <Nose avatar={avatar} />
      <Mouth avatar={avatar} />
      <FacialHair avatar={avatar} />
      <g transform={featureTransform(avatar, 'hair')}><HairFront avatar={avatar} /></g>
      <Glasses avatar={avatar} />
      <Accessory avatar={avatar} />
    </svg>
    {rank && <i className={`avatar-rank ${rank}`}>{rank === 'unranked' ? 'P' : rank.charAt(0).toUpperCase()}</i>}
  </span>;
}

export type { AvatarFaceProps };
