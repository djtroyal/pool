import { describe, expect, it } from 'vitest';
import type { ShotPlayback } from '@breakroom/game-core';
import { buildPlaybackSoundEvents } from './audio.js';

function playback(startedAt: number): ShotPlayback {
  return {
    id: 'shot', startedAt, durationMs: 2_000,
    shot: { revision: 1, angle: 0, power: 0.7, elevation: 0, english: { side: 0, vertical: 0 } },
    initialBalls: [], frames: [], finalSnapshot: {} as ShotPlayback['finalSnapshot'],
    scoreEvent: null,
    trace: {
      firstContact: 1, firstContactTime: 0.2, pocketed: [1], offTable: [], railContacts: [1],
      anyRailAfterContact: true, cueScratch: false, duration: 2,
      contacts: [
        { kind: 'ball-ball', time: 0.2, impactSpeed: 3, point: { x: 1, y: 1, z: 0 }, ballIds: [0, 1] },
        { kind: 'cushion', time: 0.6, impactSpeed: 2, point: { x: 2, y: 0, z: 0 }, ballIds: [1] },
        { kind: 'pocket', time: 1.1, impactSpeed: 1, point: { x: 3, y: 0, z: 0 }, ballIds: [1] }
      ]
    }
  };
}

describe('playback audio events', () => {
  it('schedules the strike and every physical contact at trace time', () => {
    const events = buildPlaybackSoundEvents(playback(10_000), 9_900);
    expect(events.map((event) => event.kind)).toEqual(['cue-strike', 'ball-ball', 'cushion', 'pocket']);
    expect(events.map((event) => event.atMs)).toEqual([10_000, 10_200, 10_600, 11_100]);
  });

  it('schedules only future contacts when reconnecting during playback', () => {
    const events = buildPlaybackSoundEvents(playback(10_000), 10_500);
    expect(events.map((event) => event.kind)).toEqual(['cushion', 'pocket']);
  });

  it('adds a delayed fanfare after a legally potted object ball', () => {
    const shot = playback(10_000);
    shot.finalSnapshot = { lastEvents: [{ code: 'turn-continues', message: 'Continue.' }] } as ShotPlayback['finalSnapshot'];
    shot.scoreEvent = {
      id: 'score', shooterIndex: 0, shotNumber: 1, delta: 100, totals: [100, 0], streak: 1, technique: null,
      components: [{ code: 'legal-pocket', label: 'Ball 1', points: 100, atTime: 1.1, point: { x: 3, y: 0 }, ballId: 1 }]
    };
    const fanfare = buildPlaybackSoundEvents(shot, 9_900).find((event) => event.kind === 'successful-pot');
    expect(fanfare).toMatchObject({ atMs: 11_485, impactSpeed: 1 });
  });

  it('never adds the pot fanfare when the shot is a foul', () => {
    const shot = playback(10_000);
    shot.finalSnapshot = { lastEvents: [{ code: 'scratch', message: 'Scratch.' }] } as ShotPlayback['finalSnapshot'];
    shot.scoreEvent = {
      id: 'score', shooterIndex: 0, shotNumber: 1, delta: -50, totals: [0, 0], streak: 0, technique: null,
      components: [
        { code: 'legal-pocket', label: 'Ball 1', points: 100, atTime: 1.1, point: { x: 3, y: 0 }, ballId: 1 },
        { code: 'foul', label: 'Foul', points: -100, atTime: 2, point: null, ballId: null }
      ]
    };
    expect(buildPlaybackSoundEvents(shot, 9_900).some((event) => event.kind === 'successful-pot')).toBe(false);
  });
});
