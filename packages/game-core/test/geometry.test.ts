import { describe, expect, it } from 'vitest';
import { TABLE_GEOMETRY } from '../src/index.js';

const degrees = (radians: number) => radians * 180 / Math.PI;

describe('regulation pocket geometry', () => {
  it('uses WPA mouth widths and symmetric facing angles', () => {
    const corner = TABLE_GEOMETRY.pockets.find((pocket) => pocket.id === 'top-left-pocket')!;
    const side = TABLE_GEOMETRY.pockets.find((pocket) => pocket.id === 'top-side-pocket')!;
    expect(Math.hypot(corner.mouthB.x - corner.mouthA.x, corner.mouthB.y - corner.mouthA.y)).toBeCloseTo(0.1143, 9);
    expect(Math.hypot(side.mouthB.x - side.mouthA.x, side.mouthB.y - side.mouthA.y)).toBeCloseTo(0.127, 9);
    expect(side.captureRadius).toBe(corner.captureRadius);

    const cornerJaw = TABLE_GEOMETRY.cushions.find((segment) => segment.id === 'top-left-pocket-h-jaw')!;
    const cornerDeflection = degrees(Math.atan2(Math.abs(cornerJaw.b.y - cornerJaw.a.y), Math.abs(cornerJaw.b.x - cornerJaw.a.x)));
    expect(180 - cornerDeflection).toBeCloseTo(TABLE_GEOMETRY.cornerFacingAngle, 9);

    const sideJaw = TABLE_GEOMETRY.cushions.find((segment) => segment.id === 'top-side-pocket-left-jaw')!;
    const sideSplay = degrees(Math.atan2(Math.abs(sideJaw.b.x - sideJaw.a.x), Math.abs(sideJaw.b.y - sideJaw.a.y)));
    expect(90 + sideSplay).toBeCloseTo(TABLE_GEOMETRY.sideFacingAngle, 9);
  });

  it('places every throat on its declared shelf fall line', () => {
    for (const pocket of TABLE_GEOMETRY.pockets) {
      const mouthMidpoint = { x: (pocket.mouthA.x + pocket.mouthB.x) / 2, y: (pocket.mouthA.y + pocket.mouthB.y) / 2 };
      const throatMidpoint = { x: (pocket.throatA.x + pocket.throatB.x) / 2, y: (pocket.throatA.y + pocket.throatB.y) / 2 };
      const shelf = (throatMidpoint.x - mouthMidpoint.x) * pocket.outward.x + (throatMidpoint.y - mouthMidpoint.y) * pocket.outward.y;
      expect(shelf).toBeCloseTo(pocket.kind === 'corner' ? TABLE_GEOMETRY.cornerShelf : TABLE_GEOMETRY.sideShelf, 9);
    }
  });

  it('mirrors every mouth and throat consistently around the table', () => {
    const pocket = (id: string) => TABLE_GEOMETRY.pockets.find((entry) => entry.id === id)!;
    const expectMirror = (sourceId: string, targetId: string, mirrorX: boolean, mirrorY: boolean) => {
      const source = pocket(sourceId); const target = pocket(targetId);
      for (const key of ['mouthA', 'mouthB', 'throatA', 'throatB', 'center'] as const) {
        expect(target[key].x).toBeCloseTo(mirrorX ? TABLE_GEOMETRY.width - source[key].x : source[key].x, 10);
        expect(target[key].y).toBeCloseTo(mirrorY ? TABLE_GEOMETRY.height - source[key].y : source[key].y, 10);
      }
    };
    expectMirror('top-left-pocket', 'top-right-pocket', true, false);
    expectMirror('top-left-pocket', 'bottom-left-pocket', false, true);
    expectMirror('top-side-pocket', 'bottom-side-pocket', false, true);
  });

  it('makes each rendered jaw normal perpendicular and cloth-facing', () => {
    for (const jaw of TABLE_GEOMETRY.cushions.filter((segment) => segment.kind === 'jaw')) {
      const dx = jaw.b.x - jaw.a.x; const dy = jaw.b.y - jaw.a.y;
      expect(Math.hypot(jaw.inward.x, jaw.inward.y)).toBeCloseTo(1, 10);
      expect(dx * jaw.inward.x + dy * jaw.inward.y).toBeCloseTo(0, 10);
      const midpoint = { x: (jaw.a.x + jaw.b.x) / 2, y: (jaw.a.y + jaw.b.y) / 2 };
      const clothSide = { x: midpoint.x + jaw.inward.x * 0.03, y: midpoint.y + jaw.inward.y * 0.03 };
      expect(clothSide.x).toBeGreaterThanOrEqual(0);
      expect(clothSide.x).toBeLessThanOrEqual(TABLE_GEOMETRY.width);
      expect(clothSide.y).toBeGreaterThanOrEqual(0);
      expect(clothSide.y).toBeLessThanOrEqual(TABLE_GEOMETRY.height);
    }
  });
});
