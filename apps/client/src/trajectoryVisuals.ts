import {
  BALL_COLORS,
  BALL_RADIUS,
  type ContactEvent,
  type TrajectoryPoint,
  type Vec3
} from '@breakroom/game-core';

export interface TrajectoryVisualSegment {
  from: TrajectoryPoint;
  to: TrajectoryPoint;
  speedFactor: number;
  heightFactor: number;
  airborne: boolean;
  legIndex: number;
  endsAtContact: boolean;
}

export type TrajectoryVisualMarkerKind = 'cushion' | 'jaw' | 'pocket' | 'apex' | 'landing';

export interface TrajectoryVisualMarker {
  kind: TrajectoryVisualMarkerKind;
  point: Vec3;
  time: number;
  normal?: Vec3 | undefined;
}

export interface TrajectoryVisualGeometry {
  points: TrajectoryPoint[];
  segments: TrajectoryVisualSegment[];
  markers: TrajectoryVisualMarker[];
}

const EVENT_EPSILON = 0.00002;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRail(contact: ContactEvent): boolean {
  return contact.kind === 'cushion' || contact.kind === 'jaw';
}

function relevantContacts(contacts: ContactEvent[], ballId: number): ContactEvent[] {
  return contacts
    .filter((contact) => contact.ballIds.includes(ballId))
    .sort((first, second) => first.time - second.time);
}

function eventAtTime(contacts: ContactEvent[], time: number): ContactEvent | undefined {
  return contacts.find((contact) => Math.abs(contact.time - time) <= EVENT_EPSILON);
}

function reducedPath(path: TrajectoryPoint[], contacts: ContactEvent[], pixelsPerMeter: number): TrajectoryPoint[] {
  if (path.length <= 2) return path;
  const apexIndex = path.reduce((best, point, index) => point.z > path[best]!.z ? index : best, 0);
  const minimumWorldDistance = 0.7 / Math.max(1, pixelsPerMeter);
  const result: TrajectoryPoint[] = [path[0]!];
  for (let index = 1; index < path.length - 1; index += 1) {
    const point = path[index]!;
    const previous = path[index - 1]!;
    const next = path[index + 1]!;
    const last = result.at(-1)!;
    const protectedPoint = index === apexIndex
      || point.airborne !== previous.airborne
      || point.airborne !== next.airborne
      || Boolean(eventAtTime(contacts, point.time));
    const distance = Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z);
    if (protectedPoint || distance >= minimumWorldDistance) result.push(point);
  }
  const finalPoint = path.at(-1)!;
  if (result.at(-1) !== finalPoint) result.push(finalPoint);
  return result;
}

export function buildTrajectoryVisualGeometry(
  path: TrajectoryPoint[],
  contacts: ContactEvent[],
  ballId: number,
  pixelsPerMeter: number
): TrajectoryVisualGeometry {
  if (!path.length) return { points: [], segments: [], markers: [] };
  const ballContacts = relevantContacts(contacts, ballId);
  const points = reducedPath(path, ballContacts, pixelsPerMeter);
  const rawSpeeds = points.slice(1).map((point, index) => {
    const previous = points[index]!;
    const elapsed = Math.max(0.00001, point.time - previous.time);
    return Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) / elapsed;
  });
  const maximumSpeed = Math.max(0.00001, ...rawSpeeds.filter(Number.isFinite));
  const maximumHeight = Math.max(BALL_RADIUS, ...points.map((point) => point.z));
  const heightRange = Math.max(0.00001, maximumHeight - BALL_RADIUS);
  const segments = points.slice(1).map((to, index): TrajectoryVisualSegment => {
    const from = points[index]!;
    const midpointTime = (from.time + to.time) / 2;
    const speed = Number.isFinite(rawSpeeds[index]) ? rawSpeeds[index]! : 0;
    const averageHeight = (from.z + to.z) / 2;
    return {
      from,
      to,
      speedFactor: clamp(Math.sqrt(Math.max(0, speed) / maximumSpeed), 0, 1),
      heightFactor: clamp((averageHeight - BALL_RADIUS) / heightRange, 0, 1),
      airborne: from.airborne || to.airborne,
      legIndex: ballContacts.filter((contact) => isRail(contact) && contact.time < midpointTime - EVENT_EPSILON).length,
      endsAtContact: Boolean(eventAtTime(ballContacts, to.time))
    };
  });

  const firstTime = path[0]!.time;
  const lastTime = path.at(-1)!.time;
  const markers: TrajectoryVisualMarker[] = ballContacts.flatMap((contact) => {
    if (contact.time < firstTime - EVENT_EPSILON || contact.time > lastTime + 1 / 25) return [];
    if (contact.kind !== 'cushion' && contact.kind !== 'jaw' && contact.kind !== 'pocket') return [];
    return [{ kind: contact.kind, point: contact.point, time: contact.time, normal: contact.normal }];
  });
  const airborne = path.filter((point) => point.airborne);
  if (airborne.length) {
    const apex = airborne.reduce((highest, point) => point.z > highest.z ? point : highest);
    markers.push({ kind: 'apex', point: apex, time: apex.time });
    const landingIndex = path.findIndex((point, index) => index > 0 && path[index - 1]!.airborne && !point.airborne);
    if (landingIndex >= 0) {
      const landing = path[landingIndex]!;
      markers.push({ kind: 'landing', point: landing, time: landing.time });
    }
  }
  markers.sort((first, second) => first.time - second.time);
  return { points, segments, markers };
}

export function trajectoryObjectColor(ballId: number | null): string {
  return ballId === null ? '#e2b85b' : (BALL_COLORS[ballId] ?? '#e2b85b');
}

export function trajectoryContrastUnderlay(color: string): string {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return 'rgba(2,10,7,.72)';
  const value = Number.parseInt(match[1]!, 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance < 0.24 ? 'rgba(244,248,240,.68)' : 'rgba(2,10,7,.72)';
}
