import { describe, expect, it } from 'vitest';
import { buildPaintTrailSegments } from './trails.js';

describe('paint trails', () => {
  it('forms a continuous ribbon that grows more opaque and wide toward the moving ball', () => {
    const segments = buildPaintTrailSegments([
      { x: 0, y: 0, age: 1.3 },
      { x: 1, y: 0, age: 0.9 },
      { x: 2, y: 0, age: 0.45 },
      { x: 3, y: 0, age: 0.05 }
    ]);
    expect(segments).toHaveLength(3);
    expect(segments[0]!.to).toEqual(segments[1]!.from);
    expect(segments.map((segment) => segment.alpha)).toEqual([...segments.map((segment) => segment.alpha)].sort((a, b) => a - b));
    expect(segments.map((segment) => segment.width)).toEqual([...segments.map((segment) => segment.width)].sort((a, b) => a - b));
  });

  it('drops samples once their 1.4 second lifetime expires', () => {
    expect(buildPaintTrailSegments([{ x: 0, y: 0, age: 1.5 }, { x: 2, y: 0, age: 1.45 }])).toEqual([]);
  });
});
