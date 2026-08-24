import { describe, expect, it } from 'vitest';
import {
  avatarOwned,
  defaultAvatar,
  defaultStanding,
  glicko2Update,
  inappropriateUsername,
  levelForXp,
  normalizeAvatar,
  repeatOpponentMultiplier,
  tierForRating,
  validAvatar,
  xpForLevel,
  type LegacyAvatarSpec
} from '../src/index.js';

describe('rating and level progression', () => {
  it('uses outcome-only Glicko-2 and deterministic tier boundaries', () => {
    const own = defaultStanding('eight-ball');
    const opponent = { ...defaultStanding('eight-ball'), rating: 1_200 };
    const updated = glicko2Update(own, opponent, true, 1_700_000_000_000);
    expect(updated.rating).toBeGreaterThan(own.rating);
    expect(updated.ratingDeviation).toBeLessThan(own.ratingDeviation);
    expect(updated.ratedRacks).toBe(1);
    expect(tierForRating(1_600, 5)).toBe('master');
    expect(tierForRating(1_700, 4)).toBe('unranked');
  });

  it('blocks reserved and obfuscated abusive usernames without rejecting ordinary names', () => {
    expect(inappropriateUsername('Adm1n')).toBe(true);
    expect(inappropriateUsername('n@zi')).toBe(true);
    expect(inappropriateUsername('MasseFan')).toBe(false);
  });

  it('round-trips level thresholds and diminishes repeated opponents', () => {
    for (let level = 1; level <= 20; level += 1) expect(levelForXp(xpForLevel(level))).toBe(level);
    expect([0, 1, 2, 3, 4, 5, 6].map(repeatOpponentMultiplier)).toEqual([1, 1, 1, 0.75, 0.5, 0.25, 0]);
  });
});

describe('avatar schema', () => {
  it('migrates legacy faces without losing their recognizable choices', () => {
    const legacy: LegacyAvatarSpec = {
      version: 1, skinTone: '#e8b98f', face: 'heart', hair: 'wave', hairColor: '#2a1b17', brows: 'arched', browColor: '#2a1b17',
      eyes: 'bright', eyeColor: '#315d62', nose: 'wide', mouth: 'focused', mouthColor: '#9f554d', facialHair: 'beard', glasses: 'none', mark: 'cut',
      transforms: { mark: { x: 2, y: -1, scale: 1.05, rotation: 4 } }
    };
    expect(validAvatar(legacy)).toBe(true);
    expect(normalizeAvatar(legacy, 'Legacy')).toMatchObject({
      version: 2, face: 'heart', hair: 'wave', facialHair: 'short-beard', detail: 'cut',
      transforms: { detail: { x: 2, y: -1, scale: 1.05, rotation: 4 } }
    });
  });

  it('rejects unknown parts and unlock spoofing', () => {
    const avatar = defaultAvatar('Player');
    expect(validAvatar({ ...avatar, hair: 'not-a-real-part' })).toBe(false);
    expect(validAvatar({ ...avatar, transforms: { hair: { x: 999, y: 0, scale: 1, rotation: 0 } } })).toBe(false);
    expect(avatarOwned({ ...avatar, glasses: 'round' }, [])).toBe(false);
    expect(avatarOwned({ ...avatar, glasses: 'round' }, ['avatar-round-glasses'])).toBe(true);
  });
});
