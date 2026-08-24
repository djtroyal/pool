import type { Vec2 } from '@breakroom/game-core';

export interface PaintTrailSample extends Vec2 { age: number }

export interface PaintTrailSegment {
  from: PaintTrailSample;
  to: PaintTrailSample;
  alpha: number;
  width: number;
}

export function buildPaintTrailSegments(samples: PaintTrailSample[], lifetime = 1.4): PaintTrailSegment[] {
  const moving = samples
    .filter((sample) => sample.age >= 0 && sample.age <= lifetime)
    .filter((sample, index, values) => index === 0 || Math.hypot(sample.x - values[index - 1]!.x, sample.y - values[index - 1]!.y) > 0.65);
  const segments: PaintTrailSegment[] = [];
  for (let index = 1; index < moving.length; index += 1) {
    const from = moving[index - 1]!;
    const to = moving[index]!;
    const freshness = Math.max(0, 1 - ((from.age + to.age) * 0.5) / lifetime);
    segments.push({ from, to, alpha: 0.025 + freshness * 0.19, width: 0.36 + freshness * 0.64 });
  }
  return segments;
}
