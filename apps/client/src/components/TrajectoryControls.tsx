import { TRAJECTORY_AIDS, type HostTrajectoryAidFlags, type ImpactDepth, type ReboundDepth, type TrajectoryAid, type TrajectoryAidFlags } from '@breakroom/game-core';
import { useEffect, useRef, useState } from 'react';

export const TRAJECTORY_AID_LABELS: Record<TrajectoryAid, string> = {
  advancedCuePath: 'Advanced Cue Path',
  simpleObjectPath: 'Simple Object Path',
  advancedObjectPath: 'Advanced Object Path',
  pottedPocket: 'Potted pocket',
  railContinuations: 'Rail continuations',
  jumpArc: 'Jump arc / landing'
};

interface TrajectoryControlsProps {
  value: TrajectoryAidFlags;
  allowed?: HostTrajectoryAidFlags | undefined;
  ghostTrails: boolean;
  onChange: (value: TrajectoryAidFlags) => void;
  onGhostTrailsChange: (enabled: boolean) => void;
  rebounds: ReboundDepth;
  impacts: ImpactDepth;
  onDepthChange: (value: { rebounds: ReboundDepth; impacts: ImpactDepth }) => void;
}

export function TrajectoryControls({
  value, allowed, ghostTrails, onChange, onGhostTrailsChange, rebounds, impacts, onDepthChange
}: TrajectoryControlsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeCount = TRAJECTORY_AIDS.filter((aid) => value[aid]
    && (aid === 'jumpArc' || aid === 'pottedPocket' || allowed?.[aid] !== false)).length;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('.trajectory-menu-button')?.focus();
    };
    window.addEventListener('pointerdown', closeOnPointer);
    window.addEventListener('keydown', closeOnKey);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer);
      window.removeEventListener('keydown', closeOnKey);
    };
  }, [open]);

  const changeAid = (aid: TrajectoryAid, checked: boolean) => {
    const next = { ...value, [aid]: checked };
    if (checked && aid === 'simpleObjectPath') next.advancedObjectPath = false;
    if (checked && aid === 'advancedObjectPath') next.simpleObjectPath = false;
    onChange(next);
  };

  return (
    <div className="trajectory-menu" ref={rootRef}>
      <button
        className={`trajectory-menu-button ${open ? 'open' : ''}`}
        type="button"
        aria-label="Shot aids"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Shot Aids</span><strong>{activeCount + (ghostTrails ? 1 : 0)}</strong><i aria-hidden="true">⌄</i>
      </button>
      {open && <section className="trajectory-popover" role="menu" aria-label="Shot aids">
        <header><span>Shot aids</span><small>Personal view</small></header>
        <strong className="trajectory-section-label">Trajectory aids</strong>
        <div className="trajectory-aid-list">
          {TRAJECTORY_AIDS.map((aid) => {
            const permitted = aid === 'jumpArc' || aid === 'pottedPocket' || allowed?.[aid] !== false;
            return (
              <label className={`toggle-row ${permitted ? '' : 'permission-disabled'}`} key={aid} title={permitted ? undefined : 'Disabled by the room host'}>
                <input
                  type="checkbox"
                  checked={value[aid] && permitted}
                  disabled={!permitted}
                  onChange={(event) => changeAid(aid, event.target.checked)}
                />
                <span>{TRAJECTORY_AID_LABELS[aid]}</span>
              </label>
            );
          })}
        </div>
        <div className="trajectory-depth-controls">
          <label><span>Rebounds</span><select value={rebounds} onChange={(event) => onDepthChange({ rebounds: Number(event.target.value) as ReboundDepth, impacts })}>{[0, 1, 2, 3, 4].map((depth) => <option value={depth} key={depth}>{depth}</option>)}</select></label>
          <label><span>Object impacts</span><select value={impacts} onChange={(event) => onDepthChange({ rebounds, impacts: Number(event.target.value) as ImpactDepth })}>{[1, 2, 3, 4, 5].map((depth) => <option value={depth} key={depth}>{depth}</option>)}</select></label>
        </div>
        <label className="toggle-row ghost-toggle"><input type="checkbox" checked={ghostTrails} onChange={(event) => onGhostTrailsChange(event.target.checked)} /><span>Ball trails</span></label>
      </section>}
    </div>
  );
}
