import { BALL_COLORS, type ShotPlayback } from '@breakroom/game-core';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { playBallReturnSound } from '../audio.js';

export interface PocketedBallDrag {
  id: number;
  clientX: number;
  clientY: number;
}

interface PocketedBallTrayProps {
  ids: number[];
  playback?: ShotPlayback | null;
  selectedId?: number | null;
  soundEnabled?: boolean | undefined;
  onDragStart?: ((drag: PocketedBallDrag) => void) | undefined;
  onDragMove?: ((drag: PocketedBallDrag) => void) | undefined;
  onDrop?: ((drag: PocketedBallDrag) => void) | undefined;
  onDragCancel?: (() => void) | undefined;
}

interface RollingBall {
  delay: number;
  duration: number;
}

export function PocketedBallTray({ ids, playback = null, selectedId = null, soundEnabled = true, onDragStart, onDragMove, onDrop, onDragCancel }: PocketedBallTrayProps) {
  const [drag, setDrag] = useState<PocketedBallDrag | null>(null);
  const [rollingIds, setRollingIds] = useState<Record<number, RollingBall>>({});
  const [trackWidth, setTrackWidth] = useState(520);
  const dragRef = useRef<PocketedBallDrag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const ballRefs = useRef(new Map<number, HTMLButtonElement>());
  const positionsRef = useRef(new Map<number, DOMRect>());
  const previousIdsRef = useRef(ids.filter((id) => id > 0));
  const rollTimersRef = useRef(new Map<number, number>());
  const enabled = Boolean(onDragStart && onDragMove && onDrop && onDragCancel);
  // A scratched cue ball is returned to play, never parked with the object
  // balls in a conventional return channel.
  const objectIds = ids.filter((id) => id > 0);
  const displayIds = [...objectIds].reverse();

  useLayoutEffect(() => {
    const previous = positionsRef.current;
    const next = new Map<number, DOMRect>();
    for (const [id, element] of ballRefs.current) {
      const rect = element.getBoundingClientRect();
      next.set(id, rect);
      const before = previous.get(id);
      if (!before || id in rollingIds) continue;
      const dx = before.left - rect.left;
      if (Math.abs(dx) > 0.5) element.animate(
        [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }],
        { duration: 260, easing: 'cubic-bezier(.22,.72,.24,1)' }
      );
    }
    positionsRef.current = next;
  }, [displayIds.join(','), rollingIds]);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return undefined;
    const update = () => setTrackWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const previous = new Set(previousIdsRef.current);
    const additions = objectIds.filter((id) => !previous.has(id));
    previousIdsRef.current = [...objectIds];
    if (!additions.length) return;
    const arrivals = Object.fromEntries(additions.map((id, index) => {
      const pocket = playback?.trace.contacts.find((contact) => contact.kind === 'pocket' && contact.ballIds.includes(id));
      const synchronizedDelay = pocket && playback
        ? Math.max(0, playback.startedAt + pocket.time * 1000 + 160 - Date.now())
        : 160 + index * 110;
      const duration = Math.min(4_200, 2_350 + Math.max(0, trackWidth - 300) * 2.6);
      return [id, { delay: synchronizedDelay, duration }];
    })) as Record<number, RollingBall>;
    setRollingIds((current) => ({
      ...current,
      ...arrivals
    }));
    additions.forEach((id) => {
      const existing = rollTimersRef.current.get(id);
      if (existing) window.clearTimeout(existing);
      const arrival = arrivals[id]!;
      if (soundEnabled) playBallReturnSound(arrival.delay, 0.65, arrival.duration);
      rollTimersRef.current.set(id, window.setTimeout(() => {
        setRollingIds((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        rollTimersRef.current.delete(id);
      }, arrival.delay + arrival.duration + 100));
    });
  }, [objectIds.join(','), playback, soundEnabled, trackWidth]);

  useEffect(() => () => {
    for (const timer of rollTimersRef.current.values()) window.clearTimeout(timer);
    rollTimersRef.current.clear();
  }, []);

  const cancel = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDrag(null);
    onDragCancel?.();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const beginDrag = (id: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { id, clientX: event.clientX, clientY: event.clientY };
    dragRef.current = next;
    setDrag(next);
    onDragStart?.(next);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const next = { ...dragRef.current, clientX: event.clientX, clientY: event.clientY };
    dragRef.current = next;
    setDrag(next);
    onDragMove?.(next);
  };

  const dropDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const next = { ...dragRef.current, clientX: event.clientX, clientY: event.clientY };
    dragRef.current = null;
    setDrag(null);
    onDrop?.(next);
  };

  return (
    <div className="pocketed-tray" aria-label={`Ball return. Pocketed in order: ${objectIds.join(', ') || 'none'}`}>
      <span className="pocketed-label">Ball return</span>
      <span className="return-intake" aria-hidden="true"><i /></span>
      <div className="pocketed-track" ref={trackRef}>
        <span className="return-channel-highlight" aria-hidden="true" />
        <div className="pocketed-balls">
          {ids.length === 0 && <span className="pocketed-empty">Return clear</span>}
          {displayIds.map((id, index) => {
            const rollDistance = Math.max(74, trackWidth - 20 - (displayIds.length - index) * 27);
            const rolling = rollingIds[id];
            return (
              <button
                className={`pocketed-ball ${id >= 9 ? 'stripe' : 'solid'} ${selectedId === id ? 'selected' : ''} ${enabled ? 'can-pick-up' : ''} ${id in rollingIds ? 'rolling-in' : ''}`}
                key={id}
                ref={(element) => { if (element) ballRefs.current.set(id, element); else ballRefs.current.delete(id); }}
                type="button"
                tabIndex={enabled ? 0 : -1}
                aria-label={`Pocketed ${id} ball${enabled ? '. Drag onto the table to restore.' : ''}`}
                title={enabled ? `Drag the ${id} ball onto the table` : `${id} ball`}
                onPointerDown={(event) => beginDrag(id, event)}
                onPointerMove={moveDrag}
                onPointerUp={dropDrag}
                onPointerCancel={cancel}
                style={{
                  '--ball-color': BALL_COLORS[id] ?? '#ece8d9',
                  '--roll-delay': `${rolling?.delay ?? 0}ms`,
                  '--roll-duration': `${rolling?.duration ?? 2600}ms`,
                  '--roll-distance': `${rollDistance}px`,
                  '--roll-rotation': `${Math.max(540, rollDistance / (Math.PI * 24) * 360)}deg`
                } as CSSProperties}
              ><i>{id}</i></button>
            );
          })}
        </div>
        <span className="return-backstop" aria-hidden="true" />
      </div>
      {drag && createPortal(<div className={`pocketed-ball pocketed-drag-ghost ${drag.id >= 9 ? 'stripe' : 'solid'}`} aria-hidden="true" style={{ '--ball-color': BALL_COLORS[drag.id] ?? '#ece8d9', left: drag.clientX, top: drag.clientY } as CSSProperties}><i>{drag.id}</i></div>, document.body)}
    </div>
  );
}
