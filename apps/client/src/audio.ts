import { TABLE_WIDTH, type ContactKind, type ShotPlayback } from '@breakroom/game-core';

let context: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;

export interface PlaybackSoundEvent {
  kind: 'cue-strike' | 'successful-pot' | ContactKind;
  atMs: number;
  intensity: number;
  impactSpeed: number;
  pan: number;
}

const SUCCESSFUL_POT_FANFARE_DELAY_MS = 385;
const FOUL_RULE_EVENTS = new Set([
  'scratch', 'ball-off-table', 'wrong-first-ball', 'no-rail-or-pocket',
  'illegal-break', 'shot-clock-foul', 'three-foul-loss'
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  if (!compressor) {
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.16;
    compressor.connect(context.destination);
  }
  return context;
}

function scheduleTone(
  audio: AudioContext,
  output: AudioNode,
  start: number,
  frequency: number,
  endFrequency: number,
  duration: number,
  gainValue: number,
  type: OscillatorType
): OscillatorNode {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, endFrequency), start + duration);
  gain.gain.setValueAtTime(Math.max(0.0001, gainValue), start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + duration);
  return oscillator;
}

function scheduleNoise(
  audio: AudioContext,
  output: AudioNode,
  start: number,
  duration: number,
  gainValue: number,
  cutoff: number,
  filterType: BiquadFilterType = 'lowpass',
  q = 0.7
): AudioBufferSourceNode {
  const length = Math.max(1, Math.ceil(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.value = cutoff;
  filter.Q.value = q;
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(output);
  source.start(start);
  source.stop(start + duration);
  return source;
}

export function buildPlaybackSoundEvents(playback: ShotPlayback, nowMs = Date.now()): PlaybackSoundEvent[] {
  const events: PlaybackSoundEvent[] = [];
  if (playback.startedAt >= nowMs - 4) {
    events.push({
      kind: 'cue-strike', atMs: playback.startedAt,
      intensity: clamp(0.22 + playback.shot.power * 0.78, 0, 1), impactSpeed: playback.shot.power, pan: 0
    });
  }
  for (const contact of playback.trace.contacts) {
    const atMs = playback.startedAt + contact.time * 1000;
    if (atMs < nowMs - 4) continue;
    events.push({
      kind: contact.kind,
      atMs,
      intensity: clamp(0.12 + contact.impactSpeed / 4.5, 0.12, 1),
      impactSpeed: contact.impactSpeed,
      pan: clamp(contact.point.x / TABLE_WIDTH * 2 - 1, -0.82, 0.82)
    });
  }

  const performanceFoul = playback.scoreEvent?.components.some((component) =>
    component.code === 'foul' || component.code === 'scratch'
    || component.code === 'illegal-break' || component.code === 'off-table') ?? false;
  const ruleEvents = playback.finalSnapshot.lastEvents;
  const ruleFoul = Array.isArray(ruleEvents) && ruleEvents.some((event) => FOUL_RULE_EVENTS.has(event.code));
  if (!performanceFoul && !ruleFoul) {
    const scoredPots = playback.scoreEvent?.components.filter((component) =>
      component.code === 'legal-pocket' && component.points > 0 && component.ballId !== null && component.ballId > 0
    );
    // Multiplayer scoring is authoritative. Practice has no score event, so its
    // resolved rule events provide the foul gate and the physical trace supplies
    // the successfully potted object balls.
    const potIds = scoredPots
      ? scoredPots.map((component) => component.ballId!)
      : Array.isArray(ruleEvents) ? playback.trace.pocketed.filter((ballId) => ballId > 0) : [];
    for (const ballId of new Set(potIds)) {
      const scoredPot = scoredPots?.find((component) => component.ballId === ballId);
      const contact = playback.trace.contacts.find((entry) => entry.kind === 'pocket' && entry.ballIds.includes(ballId));
      const atTime = contact?.time ?? scoredPot?.atTime;
      if (atTime === undefined) continue;
      const atMs = playback.startedAt + atTime * 1_000 + SUCCESSFUL_POT_FANFARE_DELAY_MS;
      if (atMs < nowMs - 4) continue;
      const x = contact?.point.x ?? scoredPot?.point?.x ?? TABLE_WIDTH / 2;
      const impactSpeed = contact?.impactSpeed ?? 1;
      events.push({
        kind: 'successful-pot', atMs,
        intensity: clamp(0.48 + impactSpeed / 7, 0.48, 0.88), impactSpeed,
        pan: clamp(x / TABLE_WIDTH * 2 - 1, -0.62, 0.62)
      });
    }
  }
  return events.sort((a, b) => a.atMs - b.atMs);
}

export function playShotPlayback(playback: ShotPlayback, style = 'tournament-resin'): () => void {
  const audio = getContext();
  if (!audio || !compressor) return () => undefined;
  const sources: AudioScheduledSourceNode[] = [];
  const nowMs = Date.now();
  const pitchScale = style.includes('warm') ? 0.84 : style.includes('slate') ? 1.08 : 1;
  const outputScale = style.includes('quiet') ? 0.48 : style.includes('warm') ? 0.82 : 1;
  for (const event of buildPlaybackSoundEvents(playback, nowMs)) {
    const start = audio.currentTime + Math.max(0, (event.atMs - nowMs) / 1000);
    const strength = event.intensity;
    const panner = audio.createStereoPanner();
    panner.pan.value = event.pan;
    const materialGain = audio.createGain();
    materialGain.gain.value = outputScale;
    panner.connect(materialGain).connect(compressor);
    if (event.kind === 'cue-strike') {
      sources.push(scheduleTone(audio, panner, start, 260 + strength * 120, 115, 0.07, 0.055 + strength * 0.085, 'triangle'));
      sources.push(scheduleTone(audio, panner, start + 0.012, 92, 55, 0.11, 0.025 + strength * 0.035, 'sine'));
    } else if (event.kind === 'successful-pot') {
      // A compact rising voicing confirms the legal pot after the physical drop.
      // Its upper-mid register stays clear of the low ball-return rumble.
      const fanfareGain = 0.018 + strength * 0.026;
      sources.push(scheduleTone(audio, panner, start, 523 * pitchScale, 548 * pitchScale, 0.15, fanfareGain, 'triangle'));
      sources.push(scheduleTone(audio, panner, start + 0.065, 659 * pitchScale, 690 * pitchScale, 0.18, fanfareGain * 0.92, 'sine'));
      sources.push(scheduleTone(audio, panner, start + 0.13, 784 * pitchScale, 822 * pitchScale, 0.23, fanfareGain * 0.84, 'triangle'));
      sources.push(scheduleNoise(audio, panner, start + 0.128, 0.045, 0.004 + strength * 0.004, 2_800, 'highpass', 0.75));
    } else if (event.kind === 'ball-ball') {
      const variation = 0.97 + ((event.atMs % 17) / 17) * 0.06;
      sources.push(scheduleNoise(audio, panner, start, 0.012, 0.012 + strength * 0.038, 1_650, 'highpass', 0.8));
      sources.push(scheduleTone(audio, panner, start, (2_250 + strength * 380) * variation * pitchScale, 1_620 * pitchScale, 0.021, 0.018 + strength * 0.052, 'triangle'));
      sources.push(scheduleTone(audio, panner, start + 0.0015, (3_750 + strength * 520) / variation * pitchScale, 2_480 * pitchScale, 0.014, 0.009 + strength * 0.032, 'sine'));
      sources.push(scheduleTone(audio, panner, start + 0.002, (465 + strength * 80) * pitchScale, 285 * pitchScale, 0.032, 0.012 + strength * 0.032, 'sine'));
      sources.push(scheduleTone(audio, panner, start + 0.004, 1_080 * pitchScale, 810 * pitchScale, 0.026, 0.007 + strength * 0.018, 'square'));
    } else if (event.kind === 'cushion' || event.kind === 'jaw') {
      const jaw = event.kind === 'jaw';
      sources.push(scheduleTone(audio, panner, start, jaw ? 185 : 145, jaw ? 92 : 68, jaw ? 0.075 : 0.095, 0.025 + strength * 0.065, 'triangle'));
      sources.push(scheduleNoise(audio, panner, start, 0.035, 0.006 + strength * 0.014, jaw ? 1_400 : 900));
    } else if (event.kind === 'cloth') {
      sources.push(scheduleTone(audio, panner, start, 105, 48, 0.12, 0.018 + strength * 0.055, 'sine'));
      sources.push(scheduleNoise(audio, panner, start, 0.055, 0.008 + strength * 0.02, 520));
    } else if (event.kind === 'pocket') {
      // Resin catches the pocket shelf, then drops through the leather/rubber
      // throat. Keeping those transients separate avoids a generic "thud".
      sources.push(scheduleNoise(audio, panner, start, 0.018, 0.018 + strength * 0.038, 1_850, 'highpass', 1.1));
      sources.push(scheduleTone(audio, panner, start, 520, 235, 0.038, 0.018 + strength * 0.034, 'triangle'));
      sources.push(scheduleTone(audio, panner, start + 0.018, 188, 76, 0.19, 0.052 + strength * 0.082, 'triangle'));
      sources.push(scheduleNoise(audio, panner, start + 0.025, 0.19, 0.016 + strength * 0.028, 760, 'bandpass', 1.6));
      sources.push(scheduleTone(audio, panner, start + 0.074, 78, 41, 0.3, 0.032 + strength * 0.046, 'sine'));
    } else {
      sources.push(scheduleTone(audio, panner, start, 82, 39, 0.24, 0.04 + strength * 0.065, 'sawtooth'));
      sources.push(scheduleNoise(audio, panner, start, 0.14, 0.018 + strength * 0.03, 430));
    }
  }
  for (const [index, score] of (playback.scoreEvent?.components ?? []).entries()) {
    // Legal pockets receive the fuller, delayed fanfare above instead of the
    // generic score tick used by the rest of the performance components.
    if (score.code === 'legal-pocket') continue;
    const atMs = playback.startedAt + score.atTime * 1_000 + 70;
    if (atMs < nowMs - 4) continue;
    const start = audio.currentTime + Math.max(0, (atMs - nowMs) / 1_000);
    const panner = audio.createStereoPanner();
    panner.pan.value = score.point ? clamp(score.point.x / TABLE_WIDTH * 2 - 1, -0.72, 0.72) : 0;
    panner.connect(compressor);
    if (score.points < 0) {
      sources.push(scheduleTone(audio, panner, start, 260, 145, 0.075, 0.026, 'triangle'));
    } else {
      const pitch = 610 + Math.min(420, Math.max(0, score.points)) + (index % 3) * 35;
      sources.push(scheduleTone(audio, panner, start, pitch, pitch * 0.78, 0.042, 0.018 + Math.min(0.03, score.points / 8_000), 'triangle'));
    }
  }
  return () => {
    for (const source of sources) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
  };
}

export function playBallReturnSound(delayMs = 0, position = 0.65, durationMs = 2_600): void {
  const audio = getContext();
  if (!audio || !compressor) return;
  const start = audio.currentTime + Math.max(0, delayMs) / 1000;
  const duration = clamp(durationMs / 1_000, 1.1, 4.4);
  const panner = audio.createStereoPanner();
  panner.pan.value = clamp(position, -0.8, 0.8);
  panner.connect(compressor);
  // A low rolling bed follows the visual ball across the chute. The spaced
  // knocks slow down toward the backstop, matching a ball losing momentum.
  scheduleNoise(audio, panner, start, duration * .92, 0.012, 330, 'lowpass', .55);
  scheduleNoise(audio, panner, start, duration * .88, 0.0045, 720, 'bandpass', 1.1);
  const seams = [.1, .23, .39, .58, .78];
  seams.forEach((progress, index) => {
    const at = start + duration * progress;
    const decay = 1 - index * .11;
    scheduleTone(audio, panner, at, 280 - index * 18, 138 - index * 8, .042, .018 * decay, 'triangle');
    scheduleNoise(audio, panner, at, .018, .006 * decay, 1_100, 'highpass', .8);
  });
  const stop = start + duration * .9;
  scheduleNoise(audio, panner, stop, .026, .014, 1_400, 'highpass', 1.1);
  scheduleTone(audio, panner, stop, 1_520, 980, .025, .031, 'triangle');
  scheduleTone(audio, panner, stop + .004, 255, 132, .07, .038, 'sine');
  scheduleTone(audio, panner, stop + .075, 172, 105, .05, .015, 'triangle');
}

export function playTurnSound(style = 'felt-click'): void {
  const audio = getContext();
  if (!audio || !compressor) return;
  const start = audio.currentTime + .015;
  const pitchScale = style.includes('warm') ? .9 : style.includes('glass') ? 1.14 : 1;
  scheduleNoise(audio, compressor, start, .018, .005, 1_250, 'highpass', .8);
  scheduleTone(audio, compressor, start, 392 * pitchScale, 350 * pitchScale, .09, .024, 'triangle');
  scheduleTone(audio, compressor, start + .07, 523 * pitchScale, 466 * pitchScale, .13, .031, 'sine');
}

export function playProgressSound(kind: 'score' | 'streak' | 'unlock' | 'rank', style = 'felt-click'): void {
  const audio = getContext();
  if (!audio || !compressor) return;
  const start = audio.currentTime;
  const pitchScale = style.includes('glass') ? 1.28 : style.includes('low') ? 0.76 : style.includes('brass') ? 1.08 : 1;
  if (kind === 'score') {
    scheduleTone(audio, compressor, start, 720 * pitchScale, 520 * pitchScale, 0.045, 0.028, 'triangle');
  } else if (kind === 'streak') {
    scheduleTone(audio, compressor, start, 660 * pitchScale, 880 * pitchScale, 0.08, 0.035, 'sine');
    scheduleTone(audio, compressor, start + 0.045, 990 * pitchScale, 760 * pitchScale, 0.07, 0.026, 'triangle');
  } else if (kind === 'rank') {
    scheduleTone(audio, compressor, start, 330 * pitchScale, 495 * pitchScale, 0.16, 0.042, 'triangle');
    scheduleTone(audio, compressor, start + 0.08, 495 * pitchScale, 740 * pitchScale, 0.18, 0.035, 'sine');
  } else {
    scheduleTone(audio, compressor, start, 260 * pitchScale, 520 * pitchScale, 0.18, 0.045, 'triangle');
    scheduleTone(audio, compressor, start + 0.075, 520 * pitchScale, 1_040 * pitchScale, 0.22, 0.038, 'sine');
  }
}

export function playUiSound(): void {
  const audio = getContext();
  if (!audio || !compressor) return;
  scheduleTone(audio, compressor, audio.currentTime, 520, 325, 0.055, 0.035, 'sine');
}
