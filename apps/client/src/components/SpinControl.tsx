import { useRef, type CSSProperties } from 'react';
import type { SpinInput } from '@breakroom/game-core';

interface SpinControlProps {
  value: SpinInput;
  angle: number;
  elevation: number;
  shotType: string;
  elevationLabel: string;
  disabled?: boolean;
  elevationDisabled?: boolean;
  onChange: (value: SpinInput) => void;
  onAngleChange: (angle: number) => void;
  onElevationChange: (elevation: number) => void;
}

function angleDegrees(radians: number): number { return ((radians * 180 / Math.PI) % 360 + 360) % 360; }

export function SpinControl({
  value, angle, elevation, shotType, elevationLabel, disabled = false, elevationDisabled = false,
  onChange, onAngleChange, onElevationChange
}: SpinControlProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef<HTMLDivElement>(null);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    let side = (clientX - rect.left - rect.width / 2) / (rect.width * 0.38);
    let vertical = -(clientY - rect.top - rect.height / 2) / (rect.height * 0.38);
    const length = Math.hypot(side, vertical);
    if (length > 1) { side /= length; vertical /= length; }
    if (Math.hypot(side, vertical) < 0.075) { side = 0; vertical = 0; }
    if (Math.abs(side) < 0.025) side = 0;
    if (Math.abs(vertical) < 0.025) vertical = 0;
    onChange({ side, vertical });
  };

  const updateAngleFromPointer = (clientX: number, clientY: number) => {
    const rect = angleRef.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    onAngleChange(Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2)));
  };

  const instrumentStyle = { '--angle': `${angleDegrees(angle)}deg`, '--elevation': `${elevation / 75 * 100}%` } as CSSProperties;

  return (
    <div className="spin-control shot-instrument-control" style={instrumentStyle}>
      <div
        ref={angleRef} className={`angle-donut ${disabled ? 'disabled' : ''}`} role="slider"
        aria-label="Strike angle compass" aria-valuemin={0} aria-valuemax={359.9}
        aria-valuenow={Number(angleDegrees(angle).toFixed(1))} tabIndex={disabled ? -1 : 0}
        data-angle={`${angleDegrees(angle).toFixed(1)}°`}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateAngleFromPointer(event.clientX, event.clientY); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateAngleFromPointer(event.clientX, event.clientY); }}
        onKeyDown={(event) => {
          const step = (event.shiftKey ? 0.1 : 1) * Math.PI / 180;
          if (event.key === 'ArrowLeft') onAngleChange(angle - step);
          else if (event.key === 'ArrowRight') onAngleChange(angle + step);
          else return;
          event.preventDefault();
        }}
      >
        <span className="angle-bearing" />
        <span className="angle-cardinal angle-0">0</span><span className="angle-cardinal angle-90">90</span><span className="angle-cardinal angle-180">180</span><span className="angle-cardinal angle-270">270</span>
        <div
          ref={padRef} className={`spin-pad ${disabled ? 'disabled' : ''}`} role="slider" aria-label="Cue ball English"
          aria-valuetext={`${Math.round(value.side * 100)} side, ${Math.round(value.vertical * 100)} vertical`}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event.clientX, event.clientY); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event.clientX, event.clientY); }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.02 : 0.05;
            const snap = (number: number) => Math.abs(number) < step / 2 ? 0 : Math.max(-1, Math.min(1, number));
            if (event.key === 'ArrowLeft') onChange({ ...value, side: snap(value.side - step) });
            else if (event.key === 'ArrowRight') onChange({ ...value, side: snap(value.side + step) });
            else if (event.key === 'ArrowUp') onChange({ ...value, vertical: snap(value.vertical + step) });
            else if (event.key === 'ArrowDown') onChange({ ...value, vertical: snap(value.vertical - step) });
            else if (event.key === 'Home' || event.key === '0') onChange({ side: 0, vertical: 0 });
            else return;
            event.preventDefault();
          }}
        >
          <i className="spin-axis horizontal" /><i className="spin-axis vertical" />
          <span className="spin-pad-label follow">FOLLOW</span><span className="spin-pad-label draw">DRAW</span>
          <span className="spin-dot" style={{ left: `${50 + value.side * 38}%`, top: `${50 - value.vertical * 38}%` }} />
        </div>
      </div>
      <div className="spin-footer">
        <div className="spin-values"><span>{value.vertical > 0.08 ? 'Top' : value.vertical < -0.08 ? 'Back' : 'Stun'} {Math.round(Math.abs(value.vertical) * 100)}%</span><span>Side {Math.round(value.side * 100)}%</span></div>
        <button className="center-english-control" type="button" disabled={disabled} onClick={() => onChange({ side: 0, vertical: 0 })}>Center</button>
        <strong className="shot-type-label" aria-live="polite">{shotType}</strong>
      </div>
      <label className="inline-elevation-control">
        <div><span>Cue elevation</span><strong>{Math.round(elevation)}°</strong></div>
        <input aria-label={elevationLabel} type="range" min="0" max="75" step="1" value={elevation} disabled={elevationDisabled} onChange={(event) => onElevationChange(Number(event.target.value))} />
      </label>
    </div>
  );
}
