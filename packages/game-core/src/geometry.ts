import { TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import type { Vec2 } from './types.js';

export interface CushionSegment {
  id: string;
  kind: 'cushion' | 'jaw';
  a: Vec2;
  b: Vec2;
  inward: Vec2;
}

export interface PocketGeometry {
  id: string;
  kind: 'corner' | 'side';
  center: Vec2;
  mouthA: Vec2;
  mouthB: Vec2;
  throatA: Vec2;
  throatB: Vec2;
  outward: Vec2;
  captureRadius: number;
}

export interface TableGeometry {
  width: number;
  height: number;
  railWidth: number;
  cushionWidth: number;
  cornerMouth: number;
  sideMouth: number;
  cornerShelf: number;
  sideShelf: number;
  cornerFacingAngle: number;
  sideFacingAngle: number;
  cushions: CushionSegment[];
  pockets: PocketGeometry[];
}

const CORNER_MOUTH = 0.1143;
const SIDE_MOUTH = 0.127;
const CORNER_SHELF = 0.0381;
const SIDE_SHELF = 0.00635;
const CORNER_FACING_ANGLE = 142;
const SIDE_FACING_ANGLE = 104;
const POCKET_CAPTURE_RADIUS = 0.078;
const CORNER_OFFSET = CORNER_MOUTH / Math.SQRT2;
const SIDE_HALF = SIDE_MOUTH / 2;
const CENTER_X = TABLE_WIDTH / 2;

function unitNormalToward(a: Vec2, b: Vec2, playableProbe: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const left = { x: -dy / length, y: dx / length };
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const towardPlayableSide = { x: playableProbe.x - midpoint.x, y: playableProbe.y - midpoint.y };
  return left.x * towardPlayableSide.x + left.y * towardPlayableSide.y >= 0 ? left : { x: -left.x, y: -left.y };
}

function jaw(id: string, a: Vec2, b: Vec2, playableProbe: Vec2): CushionSegment {
  return { id, kind: 'jaw', a, b, inward: unitNormalToward(a, b, playableProbe) };
}

const segments: CushionSegment[] = [
  { id: 'top-left', kind: 'cushion', a: { x: CORNER_OFFSET, y: 0 }, b: { x: CENTER_X - SIDE_HALF, y: 0 }, inward: { x: 0, y: 1 } },
  { id: 'top-right', kind: 'cushion', a: { x: CENTER_X + SIDE_HALF, y: 0 }, b: { x: TABLE_WIDTH - CORNER_OFFSET, y: 0 }, inward: { x: 0, y: 1 } },
  { id: 'bottom-left', kind: 'cushion', a: { x: CORNER_OFFSET, y: TABLE_HEIGHT }, b: { x: CENTER_X - SIDE_HALF, y: TABLE_HEIGHT }, inward: { x: 0, y: -1 } },
  { id: 'bottom-right', kind: 'cushion', a: { x: CENTER_X + SIDE_HALF, y: TABLE_HEIGHT }, b: { x: TABLE_WIDTH - CORNER_OFFSET, y: TABLE_HEIGHT }, inward: { x: 0, y: -1 } },
  { id: 'left', kind: 'cushion', a: { x: 0, y: CORNER_OFFSET }, b: { x: 0, y: TABLE_HEIGHT - CORNER_OFFSET }, inward: { x: 1, y: 0 } },
  { id: 'right', kind: 'cushion', a: { x: TABLE_WIDTH, y: CORNER_OFFSET }, b: { x: TABLE_WIDTH, y: TABLE_HEIGHT - CORNER_OFFSET }, inward: { x: -1, y: 0 } }
];

function addCorner(
  id: string,
  sx: -1 | 1,
  sy: -1 | 1,
  cornerX: number,
  cornerY: number
): PocketGeometry {
  const outward = { x: sx / Math.SQRT2, y: sy / Math.SQRT2 };
  const horizontalLip = { x: cornerX - sx * CORNER_OFFSET, y: cornerY };
  const verticalLip = { x: cornerX, y: cornerY - sy * CORNER_OFFSET };
  const deflection = (180 - CORNER_FACING_ANGLE) * Math.PI / 180;
  const horizontalDirection = { x: sx * Math.cos(deflection), y: sy * Math.sin(deflection) };
  const verticalDirection = { x: sx * Math.sin(deflection), y: sy * Math.cos(deflection) };
  const shelfProjection = horizontalDirection.x * outward.x + horizontalDirection.y * outward.y;
  const facingLength = CORNER_SHELF / shelfProjection;
  const horizontalThroat = { x: horizontalLip.x + horizontalDirection.x * facingLength, y: horizontalLip.y + horizontalDirection.y * facingLength };
  const verticalThroat = { x: verticalLip.x + verticalDirection.x * facingLength, y: verticalLip.y + verticalDirection.y * facingLength };
  segments.push(
    jaw(`${id}-h-jaw`, horizontalLip, horizontalThroat, { x: horizontalLip.x, y: horizontalLip.y - sy * 0.03 }),
    jaw(`${id}-v-jaw`, verticalLip, verticalThroat, { x: verticalLip.x - sx * 0.03, y: verticalLip.y })
  );
  return {
    id,
    kind: 'corner',
    center: { x: cornerX + sx * 0.055, y: cornerY + sy * 0.055 },
    mouthA: horizontalLip,
    mouthB: verticalLip,
    throatA: horizontalThroat,
    throatB: verticalThroat,
    outward,
    captureRadius: POCKET_CAPTURE_RADIUS
  };
}

function addSide(id: string, sy: -1 | 1, y: number): PocketGeometry {
  const outward = { x: 0, y: sy };
  const leftLip = { x: CENTER_X - SIDE_HALF, y };
  const rightLip = { x: CENTER_X + SIDE_HALF, y };
  const splay = (SIDE_FACING_ANGLE - 90) * Math.PI / 180;
  const facingLength = SIDE_SHELF / Math.cos(splay);
  const leftDirection = { x: -Math.sin(splay), y: sy * Math.cos(splay) };
  const rightDirection = { x: Math.sin(splay), y: sy * Math.cos(splay) };
  const leftThroat = { x: leftLip.x + leftDirection.x * facingLength, y: leftLip.y + leftDirection.y * facingLength };
  const rightThroat = { x: rightLip.x + rightDirection.x * facingLength, y: rightLip.y + rightDirection.y * facingLength };
  segments.push(
    jaw(`${id}-left-jaw`, leftLip, leftThroat, { x: leftLip.x - 0.03, y: leftLip.y - sy * 0.03 }),
    jaw(`${id}-right-jaw`, rightLip, rightThroat, { x: rightLip.x + 0.03, y: rightLip.y - sy * 0.03 })
  );
  return {
    id,
    kind: 'side',
    center: { x: CENTER_X, y: y + sy * 0.055 },
    mouthA: leftLip,
    mouthB: rightLip,
    throatA: leftThroat,
    throatB: rightThroat,
    outward,
    captureRadius: POCKET_CAPTURE_RADIUS
  };
}

const pockets = [
  addCorner('top-left-pocket', -1, -1, 0, 0),
  addSide('top-side-pocket', -1, 0),
  addCorner('top-right-pocket', 1, -1, TABLE_WIDTH, 0),
  addCorner('bottom-left-pocket', -1, 1, 0, TABLE_HEIGHT),
  addSide('bottom-side-pocket', 1, TABLE_HEIGHT),
  addCorner('bottom-right-pocket', 1, 1, TABLE_WIDTH, TABLE_HEIGHT)
];

export const TABLE_GEOMETRY: TableGeometry = {
  width: TABLE_WIDTH,
  height: TABLE_HEIGHT,
  railWidth: 0.14,
  cushionWidth: 0.05,
  cornerMouth: CORNER_MOUTH,
  sideMouth: SIDE_MOUTH,
  cornerShelf: CORNER_SHELF,
  sideShelf: SIDE_SHELF,
  cornerFacingAngle: CORNER_FACING_ANGLE,
  sideFacingAngle: SIDE_FACING_ANGLE,
  cushions: segments,
  pockets
};

export const POCKETS = TABLE_GEOMETRY.pockets;

/**
 * Build the visible cushion entirely behind its canonical contact face.
 * The first edge (a → b) is the exact segment used by ball physics.
 */
export function cushionBody(segment: CushionSegment, depth = TABLE_GEOMETRY.cushionWidth): [Vec2, Vec2, Vec2, Vec2] {
  const outward = { x: -segment.inward.x * depth, y: -segment.inward.y * depth };
  return [
    { ...segment.a },
    { ...segment.b },
    { x: segment.b.x + outward.x, y: segment.b.y + outward.y },
    { x: segment.a.x + outward.x, y: segment.a.y + outward.y }
  ];
}

export function pointBehindPocketFallLine(point: Vec2, pocket: PocketGeometry): boolean {
  const midpoint = {
    x: (pocket.throatA.x + pocket.throatB.x) / 2,
    y: (pocket.throatA.y + pocket.throatB.y) / 2
  };
  return (point.x - midpoint.x) * pocket.outward.x + (point.y - midpoint.y) * pocket.outward.y >= 0
    && Math.hypot(point.x - pocket.center.x, point.y - pocket.center.y) <= pocket.captureRadius;
}
