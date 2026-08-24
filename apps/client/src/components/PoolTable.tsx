import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BALL_COLORS,
  BALL_RADIUS,
  cushionBody,
  TABLE_GEOMETRY,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  type BallState,
  type ClothDesignId,
  type ClothSpeed,
  type CushionSegment,
  type GameSnapshot,
  type Quaternion,
  type ReboundDepth,
  type ImpactDepth,
  type OptimizedPot,
  type ShotPlayback,
  type SpinInput,
  type TableDesignId,
  type TrajectoryAidFlags,
  type TrajectoryPreview,
  type Vec2
} from '@breakroom/game-core';
import { buildPaintTrailSegments, type PaintTrailSegment } from '../trails.js';
import { clipTrajectoryAtFirstRail, predictedPottedPockets, simplePostContactVector } from '../trajectory.js';
import {
  buildTrajectoryVisualGeometry,
  trajectoryContrastUnderlay,
  trajectoryObjectColor,
  type TrajectoryVisualGeometry,
  type TrajectoryVisualMarker,
  type TrajectoryVisualSegment
} from '../trajectoryVisuals.js';

interface OpponentAim {
  angle: number;
  power: number;
  elevation: number;
  english: SpinInput;
}

interface PoolTableProps {
  game: GameSnapshot;
  playback: ShotPlayback | null;
  angle: number;
  power: number;
  elevation: number;
  english: SpinInput;
  interactive: boolean;
  trajectoryAids: TrajectoryAidFlags;
  reboundDepth: ReboundDepth;
  impactDepth: ImpactDepth;
  clothSpeed: ClothSpeed;
  tableDesign: TableDesignId;
  clothDesign: ClothDesignId;
  customClothColor: string;
  ghostTrails: boolean;
  cueStyle?: string | undefined;
  cueBallStyle?: string | undefined;
  ballSetStyle?: string | undefined;
  trailStyle?: string | undefined;
  futurePots?: OptimizedPot[] | undefined;
  instruction?: string | undefined;
  opponentAim?: OpponentAim | null;
  placementBallId?: number | null;
  externalDraggedBall?: { id: number; clientX: number; clientY: number } | null;
  canMoveBall?: ((ball: BallState) => boolean) | undefined;
  onAngleChange: (angle: number) => void;
  onPowerChange: (power: number) => void;
  onPowerGestureStrike: (power: number) => void;
  callSelection?: boolean | undefined;
  selectedCallBallId?: number | null | undefined;
  selectedPocketId?: string | null | undefined;
  onCallBall?: ((ballId: number) => void) | undefined;
  onCallPocket?: ((pocketId: string) => void) | undefined;
  onPlaceCue?: ((point: Vec2) => void) | undefined;
  onPlaceBall?: ((id: number, point: Vec2) => void) | undefined;
  onMoveBall?: ((id: number, point: Vec2) => void) | undefined;
}

export interface PoolTableHandle {
  pointFromClient: (clientX: number, clientY: number) => Vec2 | null;
}

interface TableTransform { scale: number; offsetX: number; offsetY: number }
interface VisualBall {
  id: number;
  x: number;
  y: number;
  z: number;
  orientation: Quaternion;
  disposition: BallState['disposition'];
  placementPreview?: boolean;
}

interface PreviewRequest {
  requestId: number;
  balls: BallState[];
  shot: { revision: number; angle: number; power: number; elevation: number; english: SpinInput };
  config: { clothSpeed: ClothSpeed; rebounds: ReboundDepth; impacts: ImpactDepth };
}

interface CachedTrajectoryGeometry {
  preview: TrajectoryPreview;
  scale: number;
  railContinuations: boolean;
  cue: TrajectoryVisualGeometry;
  object: TrajectoryVisualGeometry;
  simpleCue: TrajectoryVisualGeometry;
  simpleObject: TrajectoryVisualGeometry;
  objectPaths: Array<{ ballId: number; generation: number; geometry: TrajectoryVisualGeometry; color: string }>;
  objectColor: string;
  playableClip: Path2D;
}

const FRAME_THEMES: Record<TableDesignId, { outer: string[]; rail: string; trim: string }> = {
  'classic-walnut': { outer: ['#2c1710', '#765039', '#24130e'], rail: '#162e27', trim: '#dcb86a' },
  'light-oak': { outer: ['#76583a', '#c49a63', '#5f432c'], rail: '#23483b', trim: '#ead49b' },
  'tournament-black': { outer: ['#101514', '#35403d', '#080b0a'], rail: '#17211f', trim: '#91a39c' },
  'midnight-brass': { outer: ['#080d10', '#1c292d', '#050708'], rail: '#16272a', trim: '#c99e4e' },
  'burnished-oak': { outer: ['#422816', '#95683e', '#2a170d'], rail: '#203a31', trim: '#d6af69' },
  'graphite-edge': { outer: ['#111716', '#45514e', '#080c0b'], rail: '#1b2a27', trim: '#b2c0b9' },
  'black-chrome': { outer: ['#030505', '#1c2423', '#010202'], rail: '#111c1a', trim: '#d4ddd8' }
};

const CLOTH_COLORS: Record<Exclude<ClothDesignId, 'custom-solid'>, string> = {
  'emerald-solid': '#0c624a',
  'tournament-blue': '#176b8f',
  burgundy: '#71343e',
  charcoal: '#323c39',
  'teal-weave': '#126d67',
  'navy-diamond': '#243e62',
  'bottle-green': '#153f31',
  'ink-blue': '#152b48',
  'oxblood-weave': '#53242c',
  'night-grid': '#17262c'
};

const CUE_SHAFT_LENGTH = 1;
const TABLE_VIEW_MARGIN = 0.15;
const TABLE_VIEW_TOP_MARGIN = 0.15;
const TABLE_VIEW_BOTTOM_MARGIN = 0.15;

function worldToScreen(point: Vec2, transform: TableTransform): Vec2 {
  return { x: transform.offsetX + point.x * transform.scale, y: transform.offsetY + point.y * transform.scale };
}

/**
 * Pocket facings grow back into their adjoining rail rather than being
 * extruded perpendicular to a very short jaw. The contact edge remains a→b.
 */
function renderedCushionBody(segment: CushionSegment): [Vec2, Vec2, Vec2, Vec2] {
  if (segment.kind === 'cushion') return cushionBody(segment);
  const depth = TABLE_GEOMETRY.cushionWidth;
  const outward = Math.abs(segment.a.y) < 1e-6 ? { x: 0, y: -depth }
    : Math.abs(segment.a.y - TABLE_HEIGHT) < 1e-6 ? { x: 0, y: depth }
      : Math.abs(segment.a.x) < 1e-6 ? { x: -depth, y: 0 }
        : { x: depth, y: 0 };
  return [
    { ...segment.a }, { ...segment.b },
    { x: segment.b.x + outward.x, y: segment.b.y + outward.y },
    { x: segment.a.x + outward.x, y: segment.a.y + outward.y }
  ];
}

function playableSurfacePath(transform: TableTransform): Path2D {
  const playingArea = new Path2D();
  const topLeft = worldToScreen({ x: 0, y: 0 }, transform);
  playingArea.rect(topLeft.x, topLeft.y, TABLE_WIDTH * transform.scale, TABLE_HEIGHT * transform.scale);
  for (const cushion of TABLE_GEOMETRY.cushions) {
    const body = cushionBody(cushion).map((point) => worldToScreen(point, transform));
    playingArea.moveTo(body[0]!.x, body[0]!.y);
    for (let index = 1; index < body.length; index += 1) playingArea.lineTo(body[index]!.x, body[index]!.y);
    playingArea.closePath();
  }
  return playingArea;
}

function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let bx = b.x; let by = b.y; let bz = b.z; let bw = b.w;
  let dot = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    const q = { x: a.x + (bx - a.x) * t, y: a.y + (by - a.y) * t, z: a.z + (bz - a.z) * t, w: a.w + (bw - a.w) * t };
    const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const left = Math.sin((1 - t) * theta) / sinTheta;
  const right = Math.sin(t * theta) / sinTheta;
  return { x: a.x * left + bx * right, y: a.y * left + by * right, z: a.z * left + bz * right, w: a.w * left + bw * right };
}

function rotateVector(q: Quaternion, v: { x: number; y: number; z: number }) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

function playbackBalls(playback: ShotPlayback, now: number): VisualBall[] | null {
  const elapsed = (now - playback.startedAt) / 1000;
  if (elapsed < 0) return playback.initialBalls;
  if (elapsed * 1000 >= playback.durationMs) return null;
  const frames = playback.frames;
  let index = Math.min(frames.length - 2, Math.max(0, Math.floor(elapsed * 30)));
  while (index < frames.length - 2 && frames[index + 1]!.time < elapsed) index += 1;
  while (index > 0 && frames[index]!.time > elapsed) index -= 1;
  const first = frames[index]!;
  const second = frames[index + 1] ?? first;
  const alpha = Math.max(0, Math.min(1, (elapsed - first.time) / Math.max(0.0001, second.time - first.time)));
  return first.balls.map((ball) => {
    const next = second.balls.find((entry) => entry.id === ball.id) ?? ball;
    return {
      id: ball.id,
      x: ball.x + (next.x - ball.x) * alpha,
      y: ball.y + (next.y - ball.y) * alpha,
      z: ball.z + (next.z - ball.z) * alpha,
      orientation: slerp(ball.orientation, next.orientation, alpha),
      disposition: alpha > 0.58 ? next.disposition : ball.disposition
    };
  });
}

function clothColor(design: ClothDesignId, custom: string): string {
  return design === 'custom-solid' ? custom : CLOTH_COLORS[design];
}

function cuePalette(style: string): [string, string, string, string] {
  if (style.includes('carbon')) return ['#080a0a', '#2d3634', '#b99a54', '#dfe5dc'];
  if (style.includes('ebony') || style.includes('midnight')) return ['#090706', '#251b18', '#b8864d', '#e1c18a'];
  if (style.includes('copper')) return ['#24110b', '#9c4f2f', '#d79a63', '#f0d2a1'];
  if (style.includes('smoked')) return ['#1b100c', '#70503c', '#b99568', '#ead1a4'];
  if (style.includes('precision')) return ['#101716', '#46665c', '#d6b969', '#e7e6ce'];
  if (style.includes('technique')) return ['#160c1d', '#68477a', '#ba9760', '#ead9b5'];
  return ['#24140f', '#c89c5d', '#ead09a', '#f2e6c7'];
}

function trailColor(style: string, fallback: string): string {
  if (style.includes('amber')) return '#e8ae53';
  if (style.includes('cool')) return '#75c7df';
  if (style.includes('silver')) return '#c8d8dc';
  if (style.includes('gold')) return '#e7bd57';
  if (style.includes('rails')) return '#69d0a4';
  if (style.includes('control')) return '#72a9e8';
  if (style.includes('technique')) return '#b58ad7';
  return fallback;
}

function drawStripeBand(ctx: CanvasRenderingContext2D, center: Vec2, radius: number, axis: { x: number; y: number; z: number }, color: string): void {
  const step = Math.max(0.65, radius / 24);
  const halfBand = 0.43;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let py = -radius; py < radius; py += step) {
    const normalizedY = (py + step * 0.5) / radius;
    const halfWidth = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)) * radius;
    let runStart: number | null = null;
    for (let px = -halfWidth; px <= halfWidth + step; px += step) {
      const normalizedX = Math.min(halfWidth, px + step * 0.5) / radius;
      const depth = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX - normalizedY * normalizedY));
      const inBand = Math.abs(axis.x * normalizedX + axis.y * normalizedY + axis.z * depth) <= halfBand;
      if (inBand && runStart === null) runStart = px;
      if ((!inBand || px > halfWidth) && runStart !== null) {
        ctx.rect(center.x + runStart, center.y + py, Math.min(px, halfWidth) - runStart + step * 0.35, step + 0.35);
        runStart = null;
      }
    }
  }
  ctx.fill();
}

export const PoolTable = forwardRef<PoolTableHandle, PoolTableProps>(function PoolTable({
  game, playback, angle, power, elevation, english, interactive, trajectoryAids, reboundDepth, impactDepth, clothSpeed,
  tableDesign, clothDesign, customClothColor, ghostTrails, cueStyle = 'house-maple', cueBallStyle = 'red-dot-cue-ball', ballSetStyle = 'classic-ball-set', trailStyle = 'chalk-white', instruction, opponentAim = null, placementBallId = null, externalDraggedBall = null, futurePots = [], canMoveBall,
  onAngleChange, onPowerChange, onPowerGestureStrike, callSelection = false, selectedCallBallId = null, selectedPocketId = null,
  onCallBall, onCallPocket, onPlaceCue, onPlaceBall, onMoveBall
}: PoolTableProps, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cueOverlayRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<TableTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const previewInFlightRef = useRef(false);
  const queuedPreviewRef = useRef<PreviewRequest | null>(null);
  const previewEnabledRef = useRef(false);
  const dragBallRef = useRef<number | null>(null);
  const callSelectionPointerRef = useRef<number | null>(null);
  const powerDragRef = useRef<{ pointerId: number; x: number; y: number; initial: number; value: number; pull: number } | null>(null);
  const placementSentAtRef = useRef(0);
  const [dragPoint, setDragPoint] = useState<Vec2 | null>(null);
  const [preview, setPreview] = useState<TrajectoryPreview | null>(null);

  const pointFromClient = useCallback((clientX: number, clientY: number, requireInside = true): Vec2 | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (requireInside && (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)) return null;
    const transform = transformRef.current;
    return {
      x: Math.max(0, Math.min(TABLE_WIDTH, (clientX - rect.left - transform.offsetX) / transform.scale)),
      y: Math.max(0, Math.min(TABLE_HEIGHT, (clientY - rect.top - transform.offsetY) / transform.scale))
    };
  }, []);

  useImperativeHandle(ref, () => ({
    pointFromClient: (clientX, clientY) => pointFromClient(clientX, clientY, true)
  }), [pointFromClient]);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/preview.worker.ts', import.meta.url), { type: 'module' });
    // React Strict Mode intentionally mounts effects twice in development.
    // A terminated worker cannot still own an in-flight request.
    previewInFlightRef.current = false;
    workerRef.current = worker;
    worker.onmessage = (message: MessageEvent<{ requestId: number; preview: TrajectoryPreview }>) => {
      previewInFlightRef.current = false;
      if (previewEnabledRef.current) setPreview(message.data.preview);
      const queued = queuedPreviewRef.current;
      if (queued && previewEnabledRef.current) {
        queuedPreviewRef.current = null;
        previewInFlightRef.current = true;
        worker.postMessage(queued);
      }
    };
    return () => {
      previewEnabledRef.current = false;
      previewInFlightRef.current = false;
      queuedPreviewRef.current = null;
      workerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    const playbackRunning = Boolean(playback && Date.now() < playback.startedAt + playback.durationMs);
    const guideAvailable = !game.ballInHand || game.breakShot;
    const previewBalls = game.ballInHand && game.breakShot && dragPoint
      ? game.balls.map((ball) => ball.id === 0 ? { ...ball, ...dragPoint } : ball)
      : game.balls;
    const enabled = Boolean(worker && interactive
      && (trajectoryAids.advancedCuePath || trajectoryAids.simpleObjectPath
        || trajectoryAids.advancedObjectPath || trajectoryAids.pottedPocket || trajectoryAids.jumpArc)
      && guideAvailable && !playbackRunning);
    previewEnabledRef.current = enabled;
    if (!worker || !enabled) {
      queuedPreviewRef.current = null;
      setPreview(null);
      return;
    }
    const request: PreviewRequest = {
      requestId: ++requestRef.current,
      balls: previewBalls,
      shot: { revision: game.revision, angle, power, elevation, english },
      config: { clothSpeed, rebounds: trajectoryAids.railContinuations ? reboundDepth : 0, impacts: impactDepth }
    };
    if (previewInFlightRef.current) {
      // Replace, rather than append to, the pending work. At most one stale
      // calculation can sit ahead of the newest pointer/control state.
      queuedPreviewRef.current = request;
    } else {
      previewInFlightRef.current = true;
      worker.postMessage(request);
    }
  }, [angle, clothSpeed, dragPoint, elevation, english.side, english.vertical, game.ballInHand, game.balls, game.breakShot, game.revision, impactDepth, interactive, playback, power, reboundDepth, trajectoryAids.advancedCuePath, trajectoryAids.advancedObjectPath, trajectoryAids.jumpArc, trajectoryAids.pottedPocket, trajectoryAids.railContinuations, trajectoryAids.simpleObjectPath]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !powerDragRef.current) return;
      const previous = powerDragRef.current.initial;
      powerDragRef.current = null;
      onPowerChange(previous);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [onPowerChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame = 0;
    let trajectoryGeometryCache: CachedTrajectoryGeometry | null = null;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(260, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const cueOverlay = cueOverlayRef.current;
      const overlayRatio = Math.min(window.devicePixelRatio || 1, 2);
      const overlayWidth = window.innerWidth;
      const overlayHeight = window.innerHeight;
      const cueCtx = cueOverlay?.getContext('2d') ?? null;
      if (cueOverlay && cueCtx) {
        if (cueOverlay.width !== Math.round(overlayWidth * overlayRatio) || cueOverlay.height !== Math.round(overlayHeight * overlayRatio)) {
          cueOverlay.width = Math.round(overlayWidth * overlayRatio);
          cueOverlay.height = Math.round(overlayHeight * overlayRatio);
        }
        cueCtx.setTransform(overlayRatio, 0, 0, overlayRatio, 0, 0);
        cueCtx.clearRect(0, 0, overlayWidth, overlayHeight);
      }
      canvas.dataset.trajectoryPainted = 'false';
      canvas.dataset.trajectorySegments = '0';
      canvas.dataset.trajectoryMarkers = '0';
      canvas.dataset.objectPathColor = '';
      canvas.dataset.pottedPocket = 'false';
      canvas.dataset.pottedPockets = '';
      canvas.dataset.pottedPocketCount = '0';

      const rail = TABLE_GEOMETRY.railWidth;
      // Keep one immutable close camera. The cue is foreshortened at the
      // screen edge below, so aiming never alters this table transform.
      const minX = -TABLE_VIEW_MARGIN; const maxX = TABLE_WIDTH + TABLE_VIEW_MARGIN;
      const minY = -TABLE_VIEW_TOP_MARGIN; const maxY = TABLE_HEIGHT + TABLE_VIEW_BOTTOM_MARGIN;
      const padX = 10; const padTop = 6; const padBottom = 2;
      const scale = Math.min((width - padX * 2) / (maxX - minX), (height - padTop - padBottom) / (maxY - minY));
      const transform = {
        scale,
        offsetX: (width - (maxX - minX) * scale) / 2 - minX * scale,
        // Top alignment keeps the table anchored beneath the navigation; any
        // unavoidable aspect-ratio slack falls below, never above the slate.
        offsetY: padTop - minY * scale
      };
      transformRef.current = transform;
      const tableTopLeft = worldToScreen({ x: 0, y: 0 }, transform);
      const tableWidth = TABLE_WIDTH * scale;
      const tableHeight = TABLE_HEIGHT * scale;
      const railPx = rail * scale;
      const theme = FRAME_THEMES[tableDesign];

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = railPx * 0.55; ctx.shadowOffsetY = railPx * 0.28;
      const wood = ctx.createLinearGradient(tableTopLeft.x - railPx, tableTopLeft.y - railPx, tableTopLeft.x + tableWidth + railPx, tableTopLeft.y + tableHeight + railPx);
      theme.outer.forEach((color, index) => wood.addColorStop(index / (theme.outer.length - 1), color));
      ctx.fillStyle = wood;
      ctx.beginPath();
      ctx.roundRect(tableTopLeft.x - railPx, tableTopLeft.y - railPx, tableWidth + railPx * 2, tableHeight + railPx * 2, railPx * 0.28);
      ctx.fill();
      ctx.strokeStyle = theme.trim; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(1, railPx * 0.025); ctx.stroke();
      ctx.restore();

      const baseCloth = clothColor(clothDesign, customClothColor);
      const cloth = ctx.createRadialGradient(tableTopLeft.x + tableWidth * 0.45, tableTopLeft.y + tableHeight * 0.35, 0, tableTopLeft.x + tableWidth * 0.5, tableTopLeft.y + tableHeight * 0.5, tableWidth * 0.7);
      cloth.addColorStop(0, baseCloth); cloth.addColorStop(1, '#031b17');
      ctx.save();
      ctx.beginPath(); ctx.rect(tableTopLeft.x, tableTopLeft.y, tableWidth, tableHeight); ctx.clip();
      ctx.fillStyle = cloth; ctx.fillRect(tableTopLeft.x, tableTopLeft.y, tableWidth, tableHeight);
      ctx.globalAlpha = clothDesign.includes('weave') ? 0.14 : clothDesign.includes('diamond') ? 0.11 : 0.045; ctx.strokeStyle = '#d8ffef'; ctx.lineWidth = 0.55;
      const spacing = clothDesign.includes('diamond') ? 18 : 7;
      for (let x = tableTopLeft.x - tableHeight; x < tableTopLeft.x + tableWidth + tableHeight; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, tableTopLeft.y); ctx.lineTo(x + tableHeight, tableTopLeft.y + tableHeight); ctx.stroke();
        if (clothDesign.includes('weave') || clothDesign.includes('diamond')) { ctx.beginPath(); ctx.moveTo(x, tableTopLeft.y + tableHeight); ctx.lineTo(x + tableHeight, tableTopLeft.y); ctx.stroke(); }
      }
      ctx.restore();

      // Cut the pocket approaches out of the cloth before drawing the
      // cushions. The canonical mouth and throat points below are the same
      // geometry used by collision and trajectory prediction, so no dark
      // decoration can sit on top of a playable jaw.
      for (const pocket of TABLE_GEOMETRY.pockets) {
        const center = worldToScreen(pocket.center, transform);
        const radius = pocket.captureRadius * scale;
        const mouthA = worldToScreen(pocket.mouthA, transform); const mouthB = worldToScreen(pocket.mouthB, transform);
        const throatA = worldToScreen(pocket.throatA, transform); const throatB = worldToScreen(pocket.throatB, transform);
        const gradient = ctx.createRadialGradient(center.x - radius * 0.18, center.y - radius * 0.15, radius * 0.08, center.x, center.y, radius);
        gradient.addColorStop(0, '#090d0c'); gradient.addColorStop(0.74, '#010202'); gradient.addColorStop(1, theme.rail);
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.moveTo(mouthA.x, mouthA.y); ctx.lineTo(throatA.x, throatA.y); ctx.lineTo(center.x, center.y); ctx.lineTo(throatB.x, throatB.y); ctx.lineTo(mouthB.x, mouthB.y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.fill();
      }

      for (const segment of TABLE_GEOMETRY.cushions) {
        const body = renderedCushionBody(segment).map((point) => worldToScreen(point, transform));
        const a = body[0]!; const b = body[1]!;
        const outerB = body[2]!; const outerA = body[3]!;
        const cushionGradient = ctx.createLinearGradient(a.x, a.y, outerA.x, outerA.y);
        cushionGradient.addColorStop(0, theme.rail);
        cushionGradient.addColorStop(segment.kind === 'jaw' ? 0.5 : 0.28, theme.rail);
        cushionGradient.addColorStop(1, '#081511');
        ctx.save();
        ctx.fillStyle = cushionGradient;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(outerB.x, outerB.y); ctx.lineTo(outerA.x, outerA.y); ctx.closePath(); ctx.fill();
        if (segment.kind === 'jaw') {
          const linerFlap = cushionBody(segment, 0.01).map((point) => worldToScreen(point, transform));
          ctx.fillStyle = '#050a08';
          ctx.beginPath(); ctx.moveTo(linerFlap[0]!.x, linerFlap[0]!.y); ctx.lineTo(linerFlap[1]!.x, linerFlap[1]!.y); ctx.lineTo(linerFlap[2]!.x, linerFlap[2]!.y); ctx.lineTo(linerFlap[3]!.x, linerFlap[3]!.y); ctx.closePath(); ctx.fill();
          // A cushion-colored rubber cap hides sub-pixel rail/liner gaps at
          // shallow side-pocket facings without moving the contact edge.
          const shortSideFacing = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) < 0.015;
          ctx.strokeStyle = theme.rail;
          ctx.lineWidth = shortSideFacing ? Math.max(4, scale * 0.012) : Math.max(2, scale * 0.005); ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        // The bright seam is the contact face itself, not a decorative inset.
        ctx.strokeStyle = segment.kind === 'jaw' ? 'rgba(204,239,218,.38)' : 'rgba(204,239,218,.58)';
        ctx.lineWidth = Math.max(0.75, scale * 0.0018); ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.restore();
      }

      for (const pocket of TABLE_GEOMETRY.pockets) {
        const center = worldToScreen(pocket.center, transform); const radius = pocket.captureRadius * scale;
        if (pocket.id === selectedPocketId) {
          ctx.save(); ctx.strokeStyle = '#f1c969'; ctx.lineWidth = 2.5; ctx.shadowColor = '#f1c969'; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(center.x, center.y, radius + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      }

      const sights = [0.125, 0.25, 0.375, 0.625, 0.75, 0.875];
      ctx.fillStyle = theme.trim;
      for (const fraction of sights) for (const y of [tableTopLeft.y - railPx * 0.66, tableTopLeft.y + tableHeight + railPx * 0.66]) {
        ctx.save(); ctx.translate(tableTopLeft.x + tableWidth * fraction, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.restore();
      }

      if (game.ballInHand && game.placement === 'kitchen') {
        const kitchenX = tableTopLeft.x + tableWidth * 0.25;
        ctx.fillStyle = 'rgba(220,184,106,.07)'; ctx.fillRect(tableTopLeft.x, tableTopLeft.y, kitchenX - tableTopLeft.x, tableHeight);
        ctx.setLineDash([5, 8]); ctx.strokeStyle = 'rgba(240,213,151,.55)'; ctx.beginPath(); ctx.moveTo(kitchenX, tableTopLeft.y); ctx.lineTo(kitchenX, tableTopLeft.y + tableHeight); ctx.stroke(); ctx.setLineDash([]);
      }

      const drawTrajectorySegments = (
        geometry: TrajectoryVisualGeometry,
        coreColor: string,
        options: {
          simple?: boolean;
          airborneColor?: string;
          visible?: (segment: TrajectoryVisualSegment) => boolean;
        } = {}
      ): number => {
        const segments = geometry.segments.filter(options.visible ?? (() => true));
        if (!segments.length) return 0;
        ctx.save(); ctx.lineJoin = 'round';
        for (const segment of segments) {
          const a = worldToScreen(segment.from, transform); const b = worldToScreen(segment.to, transform);
          const continuation = !options.simple && segment.legIndex > 0;
          const heightBrightness = segment.airborne ? 0.12 * segment.heightFactor : 0;
          ctx.globalAlpha = (0.48 + segment.speedFactor * 0.47 + heightBrightness) * (continuation ? 0.8 : 1);
          ctx.strokeStyle = segment.airborne && options.airborneColor ? options.airborneColor : coreColor;
          ctx.lineWidth = 1.05 + segment.speedFactor * 1.15;
          ctx.lineCap = segment.endsAtContact ? 'butt' : 'round';
          ctx.setLineDash(options.simple ? [] : segment.airborne ? [2, 5] : continuation ? [7, 5] : []);
          ctx.shadowBlur = segment.airborne ? 2 + segment.heightFactor * 5 : 0;
          ctx.shadowColor = segment.airborne && options.airborneColor ? options.airborneColor : coreColor;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.restore();
        return segments.length;
      };
      const drawVectorTerminal = (geometry: TrajectoryVisualGeometry, color: string, underlay: string) => {
        const end = geometry.segments.at(-1)?.to;
        if (!end) return;
        const point = worldToScreen(end, transform);
        ctx.save(); ctx.fillStyle = underlay; ctx.beginPath(); ctx.arc(point.x, point.y, 3.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(point.x, point.y, 1.65, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      };
      const drawTrajectoryMarker = (marker: TrajectoryVisualMarker, color: string) => {
        const point = worldToScreen(marker.point, transform);
        ctx.save(); ctx.lineWidth = 1.2;
        if (marker.kind === 'apex') {
          ctx.strokeStyle = '#aee9ff'; ctx.shadowColor = '#78d5fa'; ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(174,233,255,.85)'; ctx.beginPath(); ctx.arc(point.x, point.y, 1, 0, Math.PI * 2); ctx.fill();
        } else if (marker.kind === 'landing') {
          const radius = BALL_RADIUS * scale * 0.65;
          ctx.strokeStyle = 'rgba(142,220,255,.82)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.ellipse(point.x, point.y, radius, radius * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 0.52; ctx.beginPath(); ctx.ellipse(point.x, point.y, radius * 0.55, radius * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (marker.kind === 'pocket') {
          ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 5;
          for (const radius of [3.2, 5.8]) { ctx.globalAlpha = radius < 4 ? 0.9 : 0.42; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.stroke(); }
        } else {
          const normal = marker.normal ?? { x: 1, y: 0, z: 0 };
          const normalLength = Math.hypot(normal.x, normal.y) || 1;
          const tangent = { x: -normal.y / normalLength, y: normal.x / normalLength };
          ctx.strokeStyle = color; ctx.fillStyle = trajectoryContrastUnderlay(color); ctx.shadowColor = color; ctx.shadowBlur = 4;
          ctx.beginPath(); ctx.moveTo(point.x - tangent.x * 4.5, point.y - tangent.y * 4.5); ctx.lineTo(point.x + tangent.x * 4.5, point.y + tangent.y * 4.5); ctx.stroke();
          ctx.translate(point.x, point.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.strokeRect(-2.2, -2.2, 4.4, 4.4);
        }
        ctx.restore();
      };
      if (interactive && preview && (!game.ballInHand || game.breakShot) && placementBallId === null) {
        if (!trajectoryGeometryCache || trajectoryGeometryCache.preview !== preview
          || Math.abs(trajectoryGeometryCache.scale - scale) > 0.01
          || trajectoryGeometryCache.railContinuations !== trajectoryAids.railContinuations) {
          const cuePath = clipTrajectoryAtFirstRail(preview, preview.cuePath, 0, trajectoryAids.railContinuations);
          const objectPath = preview.objectBallId === null ? preview.objectPath : clipTrajectoryAtFirstRail(preview, preview.objectPath, preview.objectBallId, trajectoryAids.railContinuations);
          const simpleCuePath = preview.objectBallId === null ? [] : simplePostContactVector(preview, preview.cuePath, 0);
          const simpleObjectPath = preview.objectBallId === null ? [] : simplePostContactVector(preview, preview.objectPath, preview.objectBallId);
          const objectBallId = preview.objectBallId ?? -1;
          trajectoryGeometryCache = {
            preview, scale, railContinuations: trajectoryAids.railContinuations,
            cue: buildTrajectoryVisualGeometry(cuePath, preview.contacts, 0, scale),
            object: buildTrajectoryVisualGeometry(objectPath, preview.contacts, objectBallId, scale),
            simpleCue: buildTrajectoryVisualGeometry(simpleCuePath, preview.contacts, 0, scale),
            simpleObject: buildTrajectoryVisualGeometry(simpleObjectPath, preview.contacts, objectBallId, scale),
            objectPaths: preview.objectPaths.map((path) => ({
              ballId: path.ballId,
              generation: path.generation,
              geometry: buildTrajectoryVisualGeometry(path.points, preview.contacts, path.ballId, scale),
              color: trajectoryObjectColor(path.ballId)
            })),
            objectColor: trajectoryObjectColor(preview.objectBallId),
            playableClip: playableSurfacePath(transform)
          };
        }
        const geometry = trajectoryGeometryCache;
        const cueColor = '#eef8e8'; const cueUnderlay = 'rgba(2,10,7,.72)';
        const objectUnderlay = trajectoryContrastUnderlay(geometry.objectColor);
        let paintedSegments = 0; let paintedMarkers = 0;
        ctx.save(); ctx.clip(geometry.playableClip, 'evenodd');
        if (trajectoryAids.advancedCuePath || trajectoryAids.jumpArc) {
          paintedSegments += drawTrajectorySegments(geometry.cue, cueColor, {
            airborneColor: '#8edcff',
            visible: (segment) => segment.airborne ? trajectoryAids.jumpArc : trajectoryAids.advancedCuePath
          });
        }
        if (trajectoryAids.simpleObjectPath) {
          paintedSegments += drawTrajectorySegments(geometry.simpleCue, cueColor, { simple: true });
          paintedSegments += drawTrajectorySegments(geometry.simpleObject, geometry.objectColor, { simple: true });
          drawVectorTerminal(geometry.simpleCue, cueColor, cueUnderlay);
          drawVectorTerminal(geometry.simpleObject, geometry.objectColor, objectUnderlay);
        }
        if (trajectoryAids.advancedObjectPath) {
          for (const path of geometry.objectPaths) {
            paintedSegments += drawTrajectorySegments(path.geometry, path.color, {
              visible: (segment) => segment.from.time >= (preview.objectPaths.find((entry) => entry.ballId === path.ballId)?.activatedAt ?? 0) - 0.001
            });
          }
        }
        ctx.restore();
        if ((trajectoryAids.advancedCuePath || trajectoryAids.simpleObjectPath || trajectoryAids.advancedObjectPath) && preview.ghostBall) {
          const p = worldToScreen(preview.ghostBall, transform);
          const radius = BALL_RADIUS * scale;
          ctx.save(); ctx.fillStyle = 'rgba(241,247,229,.09)'; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(2,10,7,.72)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(238,248,231,.82)'; ctx.lineWidth = 1.25; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.stroke();
          if (preview.contactPoint) {
            const contact = worldToScreen(preview.contactPoint, transform);
            ctx.fillStyle = objectUnderlay; ctx.beginPath(); ctx.arc(contact.x, contact.y, 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = geometry.objectColor; ctx.beginPath(); ctx.arc(contact.x, contact.y, 1.8, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore(); paintedMarkers += 1;
        }
        if (trajectoryAids.advancedCuePath) {
          for (const marker of geometry.cue.markers.filter((entry) => entry.kind === 'cushion' || entry.kind === 'jaw' || entry.kind === 'pocket')) { drawTrajectoryMarker(marker, cueColor); paintedMarkers += 1; }
        }
        if (trajectoryAids.advancedObjectPath) {
          for (const path of geometry.objectPaths) for (const marker of path.geometry.markers.filter((entry) => entry.kind === 'cushion' || entry.kind === 'jaw')) { drawTrajectoryMarker(marker, path.color); paintedMarkers += 1; }
          for (const impact of preview.impacts) {
            const point = worldToScreen(impact.point, transform);
            const color = trajectoryObjectColor(impact.outgoingBallId);
            ctx.save(); ctx.fillStyle = trajectoryContrastUnderlay(color); ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.shadowColor = color; ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.arc(point.x, point.y, 6.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = color; ctx.font = '700 6px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(impact.index), point.x, point.y + .3); ctx.restore();
            paintedMarkers += 1;
          }
        }
        if (trajectoryAids.jumpArc) {
          for (const marker of geometry.cue.markers.filter((entry) => entry.kind === 'apex' || entry.kind === 'landing')) { drawTrajectoryMarker(marker, '#8edcff'); paintedMarkers += 1; }
        }
        const predictedPockets = trajectoryAids.pottedPocket ? predictedPottedPockets(preview) : [];
        if (trajectoryAids.pottedPocket) {
          const markerEntries = [
            ...predictedPockets.flatMap((contact, index) => {
              const ballId = contact.ballIds.find((id) => id > 0);
              return ballId === undefined || !contact.surfaceId
                ? []
                : [{ ballId, pocketId: contact.surfaceId, order: index + 1, future: false }];
            }),
            ...futurePots.map((pot, index) => ({ ballId: pot.ballId, pocketId: pot.pocketId, order: index + 1, future: true }))
          ];
          const pocketCounts = new Map<string, number>();
          for (const marker of markerEntries) {
            const pocket = TABLE_GEOMETRY.pockets.find((entry) => entry.id === marker.pocketId);
            if (!pocket) continue;
            const stackIndex = pocketCounts.get(marker.pocketId) ?? 0;
            pocketCounts.set(marker.pocketId, stackIndex + 1);
            const center = worldToScreen(pocket.center, transform);
            const pocketRadius = pocket.captureRadius * scale;
            const pulse = (Math.sin(Date.now() / 210 + marker.order * 0.7) + 1) / 2;
            const color = BALL_COLORS[marker.ballId] ?? '#e8c475';
            const radius = pocketRadius + (marker.future ? 12 : 4) + stackIndex * 4 + pulse * (marker.future ? 0.8 : 1.6);
            ctx.save();
            ctx.strokeStyle = color; ctx.fillStyle = color; ctx.shadowColor = color;
            ctx.shadowBlur = marker.future ? 3 : 7 + pulse * 4;
            ctx.globalAlpha = marker.future ? 0.38 : 0.76;
            ctx.lineWidth = marker.future ? 1.2 : 1.6;
            if (marker.future) ctx.setLineDash([4, 5]);
            ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = marker.future ? 0.62 : 0.92; ctx.shadowBlur = 2;
            const badgeX = center.x + stackIndex * 10;
            const badgeY = center.y < height / 2
              ? center.y + pocketRadius + 16 + (marker.future ? 10 : 0)
              : center.y - pocketRadius - 14 - (marker.future ? 10 : 0);
            ctx.beginPath(); ctx.arc(badgeX, badgeY, 6.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = marker.ballId === 8 ? '#f6f2df' : '#07110e';
            ctx.font = '800 6px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(marker.ballId), badgeX, badgeY + 0.2);
            if (marker.future) {
              ctx.fillStyle = color; ctx.font = '700 5px Inter, sans-serif';
              ctx.fillText('NEXT', badgeX, badgeY + (center.y < height / 2 ? 11 : -11));
            }
            ctx.restore();
            paintedMarkers += 1;
          }
          const ids = markerEntries.map((entry) => entry.pocketId);
          canvas.dataset.pottedPocket = ids[0] ?? 'false';
          canvas.dataset.pottedPockets = ids.join(',');
          canvas.dataset.pottedPocketCount = String(ids.length);
        }
        canvas.dataset.trajectorySegments = String(paintedSegments);
        canvas.dataset.trajectoryMarkers = String(paintedMarkers);
        canvas.dataset.objectPathColor = geometry.objectColor;
        canvas.dataset.trajectoryPainted = String(paintedSegments > 0 || paintedMarkers > 0);
      }

      const now = Date.now();
      const elapsed = playback ? (now - playback.startedAt) / 1000 : -1;
      if (ghostTrails && playback && elapsed >= 0 && elapsed <= playback.trace.duration + 1.4) {
        const radius = BALL_RADIUS * scale;
        const ballIds = playback.initialBalls.map((ball) => ball.id);
        for (const ballId of ballIds) {
          const points = playback.frames.flatMap((frame) => {
            const age = elapsed - frame.time;
            if (age < 0 || age > 1.4) return [];
            const ball = frame.balls.find((entry) => entry.id === ballId);
            const point = ball ? worldToScreen(ball, transform) : null;
            return ball?.disposition === 'on-table' && point ? [{ ...point, age }] : [];
          });
          const segments = buildPaintTrailSegments(points);
          const paintSegment = (segment: PaintTrailSegment, color: string, widthScale: number, alphaScale: number) => {
            ctx.save();
            ctx.globalAlpha = segment.alpha * alphaScale;
            ctx.strokeStyle = color;
            ctx.lineWidth = radius * widthScale * segment.width;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(segment.from.x, segment.from.y); ctx.lineTo(segment.to.x, segment.to.y); ctx.stroke();
            ctx.restore();
          };
          for (const segment of segments) {
            const color = trailColor(trailStyle, BALL_COLORS[ballId] ?? '#eee');
            if (ballId >= 9) paintSegment(segment, trailColor(trailStyle, '#eee9da'), 1.38, 0.68);
            paintSegment(segment, color, ballId >= 9 ? 0.72 : 1.08, 1);
          }
        }
        for (const contact of playback.trace.contacts) {
          const age = elapsed - contact.time;
          if (age < 0 || age > 0.45) continue;
          const p = worldToScreen(contact.point, transform); const progress = age / 0.45;
          ctx.save(); ctx.globalAlpha = 1 - progress; ctx.strokeStyle = contact.kind === 'pocket' ? '#f1c66d' : contact.kind === 'cushion' || contact.kind === 'jaw' ? '#79e0b0' : '#edf7da'; ctx.lineWidth = 1.5 + Math.min(2.5, contact.impactSpeed * 0.45);
          ctx.beginPath(); ctx.arc(p.x, p.y, (5 + progress * 22) * (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.55 : 1), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      }
      if (!ghostTrails && playback && elapsed >= 0 && elapsed <= playback.trace.duration + 0.55) {
        for (const contact of playback.trace.contacts) {
          const age = elapsed - contact.time;
          if (age < 0 || age > 0.26) continue;
          const p = worldToScreen(contact.point, transform); const progress = age / 0.26;
          const color = contact.kind === 'pocket' ? '#e9bc62' : contact.kind === 'cushion' || contact.kind === 'jaw' ? '#65c696' : '#e7f0db';
          ctx.save();
          ctx.globalAlpha = (1 - progress) * 0.58;
          ctx.strokeStyle = color;
          ctx.shadowColor = color; ctx.shadowBlur = 10;
          ctx.lineWidth = 1 + Math.min(2, contact.impactSpeed * 0.32);
          ctx.beginPath(); ctx.arc(p.x, p.y, 3 + progress * 15, 0, Math.PI * 2); ctx.stroke();
          if (contact.kind === 'cushion' || contact.kind === 'jaw') {
            ctx.globalAlpha *= 0.55; ctx.fillStyle = color;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, 20 + progress * 24, 3 + progress * 2, 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
      }
      if (playback?.finalSnapshot.phase === 'rack-over' && elapsed >= playback.trace.duration && elapsed <= playback.trace.duration + 0.8) {
        const sweep = (elapsed - playback.trace.duration) / 0.8;
        ctx.save(); ctx.globalAlpha = Math.sin(Math.PI * sweep) * 0.72; ctx.strokeStyle = '#e4bc68'; ctx.lineWidth = 2.2; ctx.shadowColor = '#e4bc68'; ctx.shadowBlur = 15;
        const reveal = tableWidth * sweep;
        ctx.beginPath(); ctx.moveTo(tableTopLeft.x, tableTopLeft.y); ctx.lineTo(tableTopLeft.x + reveal, tableTopLeft.y); ctx.moveTo(tableTopLeft.x + tableWidth, tableTopLeft.y + tableHeight); ctx.lineTo(tableTopLeft.x + tableWidth - reveal, tableTopLeft.y + tableHeight); ctx.stroke(); ctx.restore();
      }

      const animated = playback ? playbackBalls(playback, now) : null;
      const baseBalls: VisualBall[] = animated ?? game.balls;
      const externalPoint = externalDraggedBall ? pointFromClient(externalDraggedBall.clientX, externalDraggedBall.clientY, true) : null;
      const balls = baseBalls.map((ball) => {
        if (game.ballInHand && ball.id === 0 && dragPoint) return { ...ball, ...dragPoint, z: BALL_RADIUS, disposition: 'on-table' as const, placementPreview: true };
        if (dragBallRef.current === ball.id && dragPoint) return { ...ball, ...dragPoint, disposition: 'on-table' as const };
        if (externalDraggedBall?.id === ball.id && externalPoint) return { ...ball, ...externalPoint, z: BALL_RADIUS, disposition: 'on-table' as const };
        return ball;
      });

      const drawBallShadow = (ball: VisualBall) => {
        if (ball.disposition !== 'on-table') return;
        const floor = worldToScreen(ball, transform); const altitude = Math.max(0, ball.z - BALL_RADIUS) * scale;
        const radius = BALL_RADIUS * scale;
        ctx.save(); ctx.globalAlpha = ball.placementPreview ? 0.24 : 0.42; ctx.filter = `blur(${Math.min(8, 2 + altitude * 0.05)}px)`; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(floor.x + radius * 0.16, floor.y + radius * 0.24, radius * (1 + altitude * 0.002), radius * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      };

      const drawBall = (ball: VisualBall) => {
        if (ball.disposition !== 'on-table') return;
        const floor = worldToScreen(ball, transform); const altitude = Math.max(0, ball.z - BALL_RADIUS) * scale;
        const point = { x: floor.x, y: floor.y - altitude * 0.28 }; const radius = BALL_RADIUS * scale;
        ctx.save(); ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = ballSetStyle.includes('muted') ? '#ded8c7' : '#f3eedc'; ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
        if (ballSetStyle.includes('high-contrast')) ctx.filter = 'saturate(1.45) contrast(1.08)';
        const marker = rotateVector(ball.orientation, { x: 0, y: 0, z: 1 });
        if (ball.id !== 0) {
          ctx.fillStyle = BALL_COLORS[ball.id] ?? '#eee';
          if (ball.id >= 9) {
            // The stripe is an equatorial band on the rotating sphere. Its
            // projected shape is derived from a separate ball-fixed pole so
            // it rolls with the quaternion instead of spinning as a flat bar.
            const stripeAxis = rotateVector(ball.orientation, { x: 0, y: 1, z: 0 });
            drawStripeBand(ctx, point, radius, stripeAxis, BALL_COLORS[ball.id] ?? '#eee');
          } else { ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2); }
        }
        const shine = ctx.createRadialGradient(point.x - radius * 0.38, point.y - radius * 0.42, radius * 0.05, point.x, point.y, radius * 1.12);
        shine.addColorStop(0, 'rgba(255,255,255,.78)'); shine.addColorStop(0.28, 'rgba(255,255,255,.07)'); shine.addColorStop(0.8, 'rgba(0,0,0,.04)'); shine.addColorStop(1, 'rgba(0,0,0,.36)');
        ctx.fillStyle = shine; ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2); ctx.restore();
        const patchX = point.x + marker.x * radius * 0.48; const patchY = point.y + marker.y * radius * 0.48;
        if (ball.id !== 0 && marker.z > -0.35) {
          const patchRadius = radius * 0.38 * Math.max(0.35, marker.z + 0.55);
          ctx.fillStyle = '#f5f0df'; ctx.beginPath(); ctx.arc(patchX, patchY, patchRadius, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#17191a'; ctx.font = `700 ${Math.max(6, patchRadius * 1.18)}px ui-sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(ball.id), patchX, patchY + 0.3);
        } else if (ball.id === 0) {
          ctx.fillStyle = cueBallStyle.includes('blue') ? 'rgba(45,94,170,.8)' : cueBallStyle.includes('graphite') ? 'rgba(45,51,52,.8)' : 'rgba(190,52,45,.72)';
          ctx.beginPath(); ctx.arc(patchX, patchY, radius * (cueBallStyle.includes('measles') ? 0.075 : 0.095), 0, Math.PI * 2); ctx.fill();
          if (cueBallStyle.includes('measles')) for (let dot = 0; dot < 4; dot += 1) { const turn = dot * Math.PI / 2; ctx.beginPath(); ctx.arc(point.x + Math.cos(turn) * radius * .54, point.y + Math.sin(turn) * radius * .54, radius * .055, 0, Math.PI * 2); ctx.fill(); }
          if (interactive && !animated) { ctx.fillStyle = 'rgba(216,68,55,.8)'; ctx.beginPath(); ctx.arc(point.x + english.side * radius * 0.58, point.y - english.vertical * radius * 0.58, radius * 0.085, 0, Math.PI * 2); ctx.fill(); }
        }
        if (ball.id > 0 && ballSetStyle.includes('geometric')) {
          ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = Math.max(1, radius * .08);
          ctx.beginPath(); ctx.moveTo(point.x - radius * .7, point.y + radius * .45); ctx.lineTo(point.x, point.y - radius * .72); ctx.lineTo(point.x + radius * .7, point.y + radius * .45); ctx.closePath(); ctx.stroke(); ctx.restore();
        }
        if (ball.placementPreview) {
          ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(238,213,151,.86)'; ctx.lineWidth = 1.25;
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        if (ball.id === selectedCallBallId) {
          ctx.save(); ctx.strokeStyle = '#f1c969'; ctx.lineWidth = 2; ctx.shadowColor = '#f1c969'; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      };

      // Shadows always remain on the cloth. Bodies are painted by elevation,
      // making an airborne ball correctly pass in front of any grounded ball
      // whose screen projection it crosses.
      for (const ball of balls) drawBallShadow(ball);
      const cueBall = balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table');
      const cueAngle = interactive ? angle : opponentAim?.angle;
      if (cueBall && cueAngle !== undefined && cueCtx && !animated && !game.ballInHand && placementBallId === null && game.phase === 'aiming') {
        const localCue = worldToScreen(cueBall, transform);
        const cue = { x: rect.left + localCue.x, y: rect.top + localCue.y };
        const shownPower = interactive ? power : opponentAim?.power ?? 0.5;
        const shownElevation = interactive ? elevation : opponentAim?.elevation ?? 0;
        const gap = (0.09 + shownPower * 0.08) * scale;
        const desiredLength = (CUE_SHAFT_LENGTH * (0.88 * Math.cos(shownElevation * Math.PI / 180) + 0.12)) * scale;
        const startX = cue.x - Math.cos(cueAngle) * gap; const startY = cue.y - Math.sin(cueAngle) * gap;
        const backX = -Math.cos(cueAngle); const backY = -Math.sin(cueAngle);
        const horizontalRoom = Math.abs(backX) < 1e-6 ? Number.POSITIVE_INFINITY
          : backX > 0 ? (overlayWidth - 10 - startX) / backX : (startX - 10) / -backX;
        const verticalRoom = Math.abs(backY) < 1e-6 ? Number.POSITIVE_INFINITY
          : backY > 0 ? (overlayHeight - 10 - startY) / backY : (startY - 10) / -backY;
        // The cue is painted in a viewport overlay, so the fixed table camera
        // never zooms or shifts merely to make room for the butt of the stick.
        const length = Math.max(20, Math.min(desiredLength, horizontalRoom, verticalRoom) - 4);
        const endX = cue.x - Math.cos(cueAngle) * (gap + length); const endY = cue.y - Math.sin(cueAngle) * (gap + length);
        const cueGradient = cueCtx.createLinearGradient(endX, endY, startX, startY);
        const cueColors = cuePalette(cueStyle);
        cueGradient.addColorStop(0, cueColors[0]); cueGradient.addColorStop(0.14, cueColors[1]); cueGradient.addColorStop(0.88, cueColors[2]); cueGradient.addColorStop(0.97, cueColors[3]); cueGradient.addColorStop(1, '#62a99a');
        cueCtx.strokeStyle = 'rgba(0,0,0,.4)'; cueCtx.lineWidth = Math.max(5, scale * 0.018); cueCtx.beginPath(); cueCtx.moveTo(endX + 2, endY + 3); cueCtx.lineTo(startX + 2, startY + 3); cueCtx.stroke();
        cueCtx.strokeStyle = cueGradient; cueCtx.lineWidth = Math.max(3.2, scale * 0.012); cueCtx.beginPath(); cueCtx.moveTo(endX, endY); cueCtx.lineTo(startX, startY); cueCtx.stroke();
        if (interactive && powerDragRef.current) {
          const lowGap = .09 * scale; const highGap = .17 * scale;
          const low = { x: cue.x - Math.cos(cueAngle) * lowGap, y: cue.y - Math.sin(cueAngle) * lowGap };
          const high = { x: cue.x - Math.cos(cueAngle) * highGap, y: cue.y - Math.sin(cueAngle) * highGap };
          const current = { x: low.x + (high.x - low.x) * shownPower, y: low.y + (high.y - low.y) * shownPower };
          cueCtx.save(); cueCtx.strokeStyle = 'rgba(231,205,137,.42)'; cueCtx.lineWidth = 1;
          cueCtx.beginPath(); cueCtx.moveTo(low.x, low.y); cueCtx.lineTo(high.x, high.y); cueCtx.stroke();
          for (const stop of [low, high]) { cueCtx.beginPath(); cueCtx.arc(stop.x, stop.y, 2.2, 0, Math.PI * 2); cueCtx.stroke(); }
          cueCtx.fillStyle = 'rgba(238,202,111,.9)'; cueCtx.shadowColor = '#e7be68'; cueCtx.shadowBlur = 8;
          cueCtx.beginPath(); cueCtx.arc(current.x, current.y, 2.8, 0, Math.PI * 2); cueCtx.fill(); cueCtx.restore();
        }
      }
      const renderOrder = [...balls].sort((first, second) => first.z - second.z || first.y - second.y);
      for (const ball of renderOrder) drawBall(ball);
      animationFrame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [angle, ballSetStyle, clothDesign, cueBallStyle, cueStyle, customClothColor, dragPoint, elevation, english, externalDraggedBall, futurePots, game, ghostTrails, interactive, opponentAim, placementBallId, playback, pointFromClient, power, preview, selectedCallBallId, selectedPocketId, tableDesign, trailStyle, trajectoryAids]);

  const toWorld = (clientX: number, clientY: number): Vec2 => pointFromClient(clientX, clientY, false)!;
  const aimAt = (point: Vec2) => {
    const cue = game.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table');
    if (cue) onAngleChange(Math.atan2(point.y - cue.y, point.x - cue.x));
  };

  return <>
    <div
      className="table-stage"
      data-trajectory-ready={preview !== null ? 'true' : 'false'}
      data-cue-path-points={preview?.cuePath.length ?? 0}
      data-object-path-points={preview?.objectPath.length ?? 0}
      data-cue-placement-preview={game.ballInHand && dragPoint ? 'true' : 'false'}
    >
      <canvas
        ref={canvasRef}
        className="pool-canvas"
        aria-label={`${game.mode === 'eight-ball' ? '8-ball' : '9-ball'} pool table. ${game.ballInHand ? 'Cue ball is in hand.' : 'Aim and strike controls are available.'}`}
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (event.button !== 0 || !powerDragRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          const active = powerDragRef.current;
          powerDragRef.current = null;
          onPowerChange(active.initial);
          if (event.currentTarget.hasPointerCapture(active.pointerId)) event.currentTarget.releasePointerCapture(active.pointerId);
        }}
        onPointerDown={(event) => {
          if (!interactive || (playback && Date.now() < playback.startedAt + playback.durationMs)) return;
          if (event.button === 0 && powerDragRef.current) {
            event.preventDefault();
            const active = powerDragRef.current;
            powerDragRef.current = null;
            onPowerChange(active.initial);
            if (event.currentTarget.hasPointerCapture(active.pointerId)) event.currentTarget.releasePointerCapture(active.pointerId);
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          if (event.button === 2) {
            if (!game.ballInHand && placementBallId === null) powerDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, initial: power, value: power, pull: 0 };
            return;
          }
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          const point = toWorld(event.clientX, event.clientY);
          if (placementBallId !== null && onPlaceBall) { dragBallRef.current = placementBallId; setDragPoint(point); return; }
          if (game.ballInHand) { dragBallRef.current = 0; setDragPoint(point); return; }
          if (callSelection) {
            const pocket = TABLE_GEOMETRY.pockets.map((entry) => ({ entry, distance: Math.hypot(entry.center.x - point.x, entry.center.y - point.y) })).sort((a, b) => a.distance - b.distance)[0];
            if (pocket && pocket.distance <= pocket.entry.captureRadius * 1.9) { callSelectionPointerRef.current = event.pointerId; onCallPocket?.(pocket.entry.id); return; }
            const calledBall = game.balls.filter((ball) => ball.id > 0 && ball.disposition === 'on-table').map((ball) => ({ ball, distance: Math.hypot(ball.x - point.x, ball.y - point.y) })).sort((a, b) => a.distance - b.distance)[0];
            if (calledBall && calledBall.distance <= BALL_RADIUS * 1.7) { callSelectionPointerRef.current = event.pointerId; onCallBall?.(calledBall.ball.id); return; }
          }
          if (onMoveBall && canMoveBall) {
            const nearest = game.balls.filter((ball) => ball.disposition === 'on-table' && canMoveBall(ball)).map((ball) => ({ ball, distance: Math.hypot(ball.x - point.x, ball.y - point.y) })).sort((a, b) => a.distance - b.distance)[0];
            if (nearest && nearest.distance < BALL_RADIUS * 1.65) { dragBallRef.current = nearest.ball.id; setDragPoint(point); return; }
          }
          aimAt(point);
        }}
        onPointerMove={(event) => {
          if (!interactive) return;
          if (callSelectionPointerRef.current === event.pointerId) return;
          const powerDrag = powerDragRef.current;
          if (powerDrag?.pointerId === event.pointerId) {
            const pull = Math.max(0, -((event.clientX - powerDrag.x) * Math.cos(angle) + (event.clientY - powerDrag.y) * Math.sin(angle)));
            const next = pull < 8 ? 0.04 : Math.min(1, 0.04 + (pull - 8) / 172 * 0.96);
            powerDrag.pull = pull; powerDrag.value = next; onPowerChange(next); return;
          }
          const point = toWorld(event.clientX, event.clientY);
          if (game.ballInHand) { setDragPoint(point); return; }
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          if (dragBallRef.current !== null) setDragPoint(point); else aimAt(point);
        }}
        onPointerLeave={(event) => {
          if (game.ballInHand && !event.currentTarget.hasPointerCapture(event.pointerId)) setDragPoint(null);
        }}
        onPointerUp={(event) => {
          const powerDrag = powerDragRef.current;
          if (powerDrag?.pointerId === event.pointerId) {
            powerDragRef.current = null;
            if (powerDrag.pull >= 8) onPowerGestureStrike(powerDrag.value);
            else onPowerChange(powerDrag.initial);
            return;
          }
          if (callSelectionPointerRef.current === event.pointerId) {
            callSelectionPointerRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          if (!interactive || (event.pointerType === 'mouse' && event.button !== 0)) return;
          const point = toWorld(event.clientX, event.clientY); const dragged = dragBallRef.current;
          dragBallRef.current = null; setDragPoint(dragged === 0 && game.ballInHand ? point : null);
          if (dragged !== null && dragged === placementBallId && onPlaceBall) onPlaceBall(dragged, point);
          else if (dragged === 0 && game.ballInHand && onPlaceCue) { placementSentAtRef.current = Date.now(); onPlaceCue(point); }
          else if (dragged !== null && onMoveBall) onMoveBall(dragged, point);
        }}
        onPointerCancel={() => {
          if (powerDragRef.current) onPowerChange(powerDragRef.current.initial);
          powerDragRef.current = null; dragBallRef.current = null; callSelectionPointerRef.current = null; setDragPoint(null);
        }}
        onClick={(event) => {
          // Some touch engines synthesize a click without a usable PointerEvent
          // button value. This is a guarded fallback; normal pointer placement
          // stamps the ref above so the same tap cannot be submitted twice.
          if (!interactive || !game.ballInHand || !onPlaceCue || Date.now() - placementSentAtRef.current < 500) return;
          placementSentAtRef.current = Date.now();
          onPlaceCue(toWorld(event.clientX, event.clientY));
        }}
      />
      {placementBallId !== null && interactive && <div className="table-callout" role="status" aria-live="polite">Place the {placementBallId} ball on open cloth</div>}
      {placementBallId === null && game.ballInHand && interactive && <div className="table-callout" role="status" aria-live="polite">Place the cue ball {game.placement === 'kitchen' ? 'behind the head string' : 'on open cloth'}</div>}
      {placementBallId === null && !game.ballInHand && instruction && <div className="table-callout table-instruction" role="status" aria-live="polite">{instruction}</div>}
    </div>
    {createPortal(<canvas className="cue-overlay-canvas" ref={cueOverlayRef} aria-hidden="true" />, document.body)}
  </>;
});
