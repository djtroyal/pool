import {
  AVATAR_PARTS,
  AVATAR_PALETTES,
  COSMETIC_CATALOG,
  DEFAULT_AVATAR_TRANSFORM,
  availableAvatarParts,
  normalizeAvatar,
  type AvatarColorField,
  type AvatarFeature,
  type AvatarPartTransform,
  type AvatarSpec,
  type PlayerProfile
} from '@breakroom/game-core';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AvatarFace } from './AvatarFace.js';

interface AvatarStudioProps {
  profile: PlayerProfile;
  onSave: (avatar: AvatarSpec) => Promise<void>;
}

interface StudioGroup {
  id: string;
  label: string;
  features: AvatarFeature[];
}

const GROUPS: StudioGroup[] = [
  { id: 'shape', label: 'Face', features: ['face', 'ears'] },
  { id: 'hair', label: 'Hair', features: ['hair', 'brows'] },
  { id: 'features', label: 'Features', features: ['eyes', 'nose', 'mouth'] },
  { id: 'details', label: 'Details', features: ['facialHair', 'detail'] },
  { id: 'accessories', label: 'Accessories', features: ['glasses', 'accessory'] }
];

const FEATURE_LABELS: Record<AvatarFeature, string> = {
  face: 'Face shape', ears: 'Ears', hair: 'Hair', brows: 'Brows', eyes: 'Eyes', nose: 'Nose', mouth: 'Mouth',
  facialHair: 'Facial hair', glasses: 'Glasses', detail: 'Face detail', accessory: 'Accessory'
};

const FEATURE_COLORS: Record<AvatarFeature, AvatarColorField> = {
  face: 'skinTone', ears: 'skinTone', hair: 'hairColor', brows: 'browColor', eyes: 'eyeColor', nose: 'skinTone',
  mouth: 'mouthColor', facialHair: 'hairColor', glasses: 'glassesColor', detail: 'detailColor', accessory: 'accessoryColor'
};

const TRANSFORM_LIMITS: Record<keyof AvatarPartTransform, { label: string; min: number; max: number; step: number }> = {
  x: { label: 'Left / right', min: -12, max: 12, step: 1 },
  y: { label: 'Up / down', min: -12, max: 12, step: 1 },
  scale: { label: 'Size', min: 0.75, max: 1.3, step: 0.01 },
  rotation: { label: 'Rotation', min: -20, max: 20, step: 1 }
};

function cloneAvatar(avatar: AvatarSpec): AvatarSpec {
  return { ...avatar, transforms: Object.fromEntries(Object.entries(avatar.transforms).map(([key, value]) => [key, { ...value }])) };
}

function randomEntry<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

export function AvatarStudio({ profile, onSave }: AvatarStudioProps) {
  const initial = useMemo(() => normalizeAvatar(profile.avatar, profile.name), [profile.avatar, profile.name]);
  const [timeline, setTimeline] = useState<{ entries: AvatarSpec[]; index: number }>({ entries: [initial], index: 0 });
  const [groupId, setGroupId] = useState(GROUPS[0]!.id);
  const [feature, setFeature] = useState<AvatarFeature>(GROUPS[0]!.features[0]!);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const avatar = timeline.entries[timeline.index]!;
  const baseline = JSON.stringify(initial);
  const dirty = JSON.stringify(avatar) !== baseline;
  const group = GROUPS.find((entry) => entry.id === groupId) ?? GROUPS[0]!;
  const colorField = FEATURE_COLORS[feature];
  const unlocks = useMemo(() => new Set(profile.unlocks), [profile.unlocks]);

  useEffect(() => {
    setTimeline({ entries: [initial], index: 0 });
    setStatus('idle');
    setError('');
  }, [initial]);

  const commit = (next: AvatarSpec) => {
    setTimeline((current) => {
      const entries = [...current.entries.slice(0, current.index + 1), cloneAvatar(next)].slice(-50);
      return { entries, index: entries.length - 1 };
    });
    setStatus('idle');
    setError('');
  };

  const chooseGroup = (next: StudioGroup) => {
    setGroupId(next.id);
    if (!next.features.includes(feature)) setFeature(next.features[0]!);
  };

  const choosePart = (partId: string) => commit({ ...avatar, [feature]: partId } as AvatarSpec);
  const chooseColor = (field: AvatarColorField, value: string) => commit({ ...avatar, [field]: value });
  const transform = avatar.transforms[feature] ?? DEFAULT_AVATAR_TRANSFORM;
  const setTransform = (key: keyof AvatarPartTransform, value: number) => commit({
    ...avatar,
    transforms: { ...avatar.transforms, [feature]: { ...transform, [key]: value } }
  });

  const randomize = () => {
    const next = cloneAvatar(avatar);
    for (const currentFeature of Object.keys(AVATAR_PARTS) as AvatarFeature[]) {
      next[currentFeature] = randomEntry(availableAvatarParts(currentFeature, unlocks)).id;
    }
    for (const field of Object.keys(AVATAR_PALETTES) as AvatarColorField[]) next[field] = randomEntry(AVATAR_PALETTES[field]);
    next.browColor = next.hairColor;
    next.transforms = {};
    commit(next);
  };

  const save = async () => {
    if (!dirty || status === 'saving') return;
    setStatus('saving'); setError('');
    try { await onSave(avatar); setStatus('saved'); }
    catch (reason) { setStatus('error'); setError(reason instanceof Error ? reason.message : 'Avatar could not be saved.'); }
  };

  return <div className="avatar-builder-studio">
    <aside className="avatar-studio-preview">
      <div className="avatar-preview-stage"><AvatarFace avatar={avatar} rank={profile.standings['eight-ball'].tier} size="studio" /></div>
      <div className="avatar-studio-actions">
        <button type="button" onClick={() => setTimeline((current) => ({ ...current, index: Math.max(0, current.index - 1) }))} disabled={timeline.index === 0} aria-label="Undo avatar change">↶ <span>Undo</span></button>
        <button type="button" onClick={() => setTimeline((current) => ({ ...current, index: Math.min(current.entries.length - 1, current.index + 1) }))} disabled={timeline.index === timeline.entries.length - 1} aria-label="Redo avatar change">↷ <span>Redo</span></button>
        <button type="button" onClick={randomize}>Randomize</button>
        <button type="button" onClick={() => commit(initial)} disabled={!dirty}>Revert</button>
      </div>
      <div className={`avatar-save-status ${status}`} aria-live="polite">
        <span>{status === 'saving' ? 'Saving…' : status === 'saved' && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
        {error && <small>{error}</small>}
      </div>
      <button className="primary-button avatar-save-button" type="button" disabled={!dirty || status === 'saving'} onClick={save}>Save avatar</button>
    </aside>

    <section className="avatar-workbench">
      <nav className="avatar-group-tabs" aria-label="Avatar feature groups">
        {GROUPS.map((entry) => <button type="button" className={entry.id === group.id ? 'active' : ''} aria-pressed={entry.id === group.id} key={entry.id} onClick={() => chooseGroup(entry)}>{entry.label}</button>)}
      </nav>
      <div className="avatar-feature-tabs" role="tablist" aria-label={`${group.label} parts`}>
        {group.features.map((entry) => <button type="button" role="tab" aria-selected={entry === feature} className={entry === feature ? 'active' : ''} key={entry} onClick={() => setFeature(entry)}>{FEATURE_LABELS[entry]}</button>)}
      </div>

      <div className="avatar-parts" role="group" aria-label={`${FEATURE_LABELS[feature]} choices`}>
        {AVATAR_PARTS[feature].map((part) => {
          const locked = Boolean(part.unlockId && !unlocks.has(part.unlockId));
          const level = part.unlockId ? COSMETIC_CATALOG.find((entry) => entry.id === part.unlockId)?.level : undefined;
          const candidate = { ...avatar, [feature]: part.id } as AvatarSpec;
          return <button
            type="button" key={part.id} disabled={locked} aria-pressed={avatar[feature] === part.id}
            className={`${avatar[feature] === part.id ? 'selected' : ''} ${locked ? 'locked' : ''}`}
            title={locked ? `Unlocks at level ${level ?? '?'}` : part.label} onClick={() => choosePart(part.id)}
          >
            <AvatarFace avatar={candidate} size="small" decorative />
            <span>{part.label}</span>
            {locked && <small>LV {level ?? '?'}</small>}
          </button>;
        })}
      </div>

      <div className="avatar-fine-controls">
        <section className="avatar-color-control">
          <header><span>{colorField === 'skinTone' ? 'Skin tone' : `${FEATURE_LABELS[feature]} color`}</span><code>{avatar[colorField].toUpperCase()}</code></header>
          <div className="avatar-palette">
            {AVATAR_PALETTES[colorField].map((value) => <button type="button" key={value} className={avatar[colorField] === value ? 'selected' : ''} aria-label={`Use color ${value}`} aria-pressed={avatar[colorField] === value} style={{ '--swatch': value } as CSSProperties} onClick={() => chooseColor(colorField, value)} />)}
            <label className="avatar-custom-color" title="Custom color"><span>+</span><input type="color" value={avatar[colorField]} aria-label="Custom avatar color" onInput={(event) => chooseColor(colorField, event.currentTarget.value)} /></label>
          </div>
          {feature === 'brows' && <button className="avatar-match-color" type="button" onClick={() => chooseColor('browColor', avatar.hairColor)}>Match hair</button>}
          {(group.id === 'shape' || group.id === 'accessories') && <div className="avatar-background-control"><span>Backdrop</span><div className="avatar-palette">{AVATAR_PALETTES.backgroundColor.map((value) => <button type="button" key={value} className={avatar.backgroundColor === value ? 'selected' : ''} aria-label={`Use backdrop ${value}`} aria-pressed={avatar.backgroundColor === value} style={{ '--swatch': value } as CSSProperties} onClick={() => chooseColor('backgroundColor', value)} />)}</div></div>}
        </section>

        <details className="avatar-transform-control">
          <summary><span>Fine tune {FEATURE_LABELS[feature]}</span><small>Position · size · angle</small></summary>
          <div>
            {(Object.keys(TRANSFORM_LIMITS) as Array<keyof AvatarPartTransform>).map((key) => {
              const settings = TRANSFORM_LIMITS[key];
              return <label key={key}><span>{settings.label}<b>{key === 'scale' ? `${Math.round(transform[key] * 100)}%` : `${transform[key]}${key === 'rotation' ? '°' : ''}`}</b></span><input type="range" min={settings.min} max={settings.max} step={settings.step} value={transform[key]} onChange={(event) => setTransform(key, Number(event.target.value))} /></label>;
            })}
            <button type="button" onClick={() => commit({ ...avatar, transforms: { ...avatar.transforms, [feature]: { ...DEFAULT_AVATAR_TRANSFORM } } })}>Reset adjustments</button>
          </div>
        </details>
      </div>
    </section>
  </div>;
}
