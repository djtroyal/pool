import { describe, expect, it } from 'vitest';
import { CosmeticLockedError, PassportInvalidError, ProfileNameBlockedError, ProfileNameTakenError, ProgressionStore } from './progression.js';

describe('persistent progression store', () => {
  it('accepts one-character globally unique names and resumes by bearer token', () => {
    const store = new ProgressionStore(':memory:');
    const created = store.createProfile('Q');
    expect(created.profile.name).toBe('Q');
    expect(store.resumeProfile(created.session.token).profile.id).toBe(created.profile.id);
    expect(() => store.createProfile('q')).toThrow(ProfileNameTakenError);
    store.close();
  });

  it('rotates recovery keys, stores avatars, and rejects blocked names', () => {
    const store = new ProgressionStore(':memory:');
    const created = store.createProfile('Face');
    const avatar = { ...created.profile.avatar, hair: 'curls', eyeColor: '#315d62' };
    expect(store.updateAvatar(created.profile.id, avatar).avatar).toMatchObject({ hair: 'curls', eyeColor: '#315d62' });
    expect(() => store.updateAvatar(created.profile.id, { ...avatar, glasses: 'round' })).toThrow(CosmeticLockedError);
    const recovered = store.recoverProfile(created.recoveryKey);
    expect(recovered.profile.id).toBe(created.profile.id);
    expect(() => store.recoverProfile(created.recoveryKey)).toThrow();
    expect(store.resumeProfile(recovered.session.token).profile.id).toBe(created.profile.id);
    expect(() => store.createProfile('Adm1n')).toThrow(ProfileNameBlockedError);
    store.close();
  });

  it('supports mutual friends and public stat/playstyle reads', () => {
    const store = new ProgressionStore(':memory:');
    const first = store.createProfile('FriendA'); const second = store.createProfile('FriendB');
    store.requestFriend(first.profile.id, second.profile.id);
    expect(store.friendRecords(second.profile.id).requests[0]?.direction).toBe('incoming');
    store.respondFriend(second.profile.id, first.profile.id, true);
    expect(store.friendRecords(first.profile.id).friendIds).toContain(second.profile.id);
    store.recordShot(first.profile.id, 'eight-ball', false, { strokes: 1, scratches: 1, powerSum: .8 });
    expect(store.publicProfile(first.profile.id).stats.total).toMatchObject({ strokes: 1, scratches: 1, powerSum: .8 });
    store.close();
  });

  it('rejects modified passports and revokes old passports during recovery', () => {
    const store = new ProgressionStore(':memory:');
    const created = store.createProfile('Passport');
    const modified = `${created.session.token.slice(0, -1)}${created.session.token.endsWith('A') ? 'B' : 'A'}`;
    expect(() => store.resumeProfile(modified)).toThrow(PassportInvalidError);
    const recovered = store.recoverProfile(created.recoveryKey);
    expect(() => store.resumeProfile(created.session.token)).toThrow(PassportInvalidError);
    expect(store.resumeProfile(recovered.session.token).profile.id).toBe(created.profile.id);
    store.close();
  });

  it('spends available XP atomically without reducing lifetime XP or level', () => {
    const store = new ProgressionStore(':memory:');
    const created = store.createProfile('Shopper');
    store.db.prepare('UPDATE profiles SET total_xp = 3000, level = 4 WHERE id = ?').run(created.profile.id);
    const first = store.purchase(created.profile.id, 'cue-smoked-maple', 'purchase_request_01');
    const repeated = store.purchase(created.profile.id, 'cue-smoked-maple', 'purchase_request_01');
    expect(first.profile.unlocks).toContain('cue-smoked-maple');
    expect(first.profile.totalXp).toBe(3000);
    expect(first.profile.level).toBe(4);
    expect(first.profile.xpSpent).toBeGreaterThan(0);
    expect(first.profile.availableXp).toBe(first.profile.totalXp - first.profile.xpSpent);
    expect(repeated.profile.xpSpent).toBe(first.profile.xpSpent);
    expect(store.resumeProfile(first.session.token).profile.unlocks).toContain('cue-smoked-maple');
    store.close();
  });

  it('settles a ranked rack once and persists rating, XP, and results', () => {
    const store = new ProgressionStore(':memory:');
    const first = store.createProfile('A');
    const second = store.createProfile('B');
    const input = {
      rackId: 'rack-1', competition: 'ranked' as const, mode: 'eight-ball' as const,
      profileIds: [first.profile.id, second.profile.id] as [string, string], winnerIndex: 0 as const,
      performanceScores: [1_200, 450] as [number, number], mastery: [{ precision: 10 }, {}] as [{ precision: number }, Record<string, never>], endedAt: Date.now()
    };
    const settlement = store.settleRack(input);
    const duplicate = store.settleRack(input);
    expect(duplicate).toEqual(settlement);
    expect(settlement.rewards[0].xp).toBeGreaterThan(settlement.rewards[1].xp);
    const winner = store.getProfile(first.profile.id);
    expect(winner.standings['eight-ball'].ratedRacks).toBe(1);
    expect(winner.standings['eight-ball'].rating).toBeGreaterThan(1_000);
    expect(winner.mastery.precision).toBe(10);
    expect(winner.unlocks).toContain('precision-mastery-1');
    store.close();
  });

  it('awards challenge XP only for personal-best and medal improvements', () => {
    const store = new ProgressionStore(':memory:');
    const player = store.createProfile('Drill');
    const first = store.awardChallenge(player.profile.id, 'stop-line', 720, 2);
    const repeated = store.awardChallenge(player.profile.id, 'stop-line', 720, 2);
    expect(first.xp).toBeGreaterThan(0);
    expect(repeated.xp).toBe(0);
    expect(repeated.profile.challenges).toContainEqual({ challengeId: 'stop-line', medal: 2, bestScore: 720 });
    store.close();
  });

  it('builds overall leaderboard values from persisted XP', () => {
    const store = new ProgressionStore(':memory:');
    const first = store.createProfile('Alpha');
    const second = store.createProfile('Beta');
    store.settleRack({
      rackId: 'rack-2', competition: 'casual', mode: 'nine-ball',
      profileIds: [first.profile.id, second.profile.id], winnerIndex: 1,
      performanceScores: [200, 1_500], mastery: [{}, {}], endedAt: Date.now()
    });
    const page = store.leaderboard('overall', 'all-time', second.profile.id);
    expect(page.entries[0]).toMatchObject({ name: 'Beta', isSelf: true });
    store.close();
  });
});
