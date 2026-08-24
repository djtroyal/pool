import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { strikeVelocityColor } from '../shotTechnique.js';

interface StrikeControlProps {
  power: number;
  disabled: boolean;
  label: string;
  onPowerChange: (power: number) => void;
  onStrike: (power: number) => void;
  onReset: () => void;
}

export function StrikeControl({ power, disabled, label, onPowerChange, onStrike, onReset }: StrikeControlProps) {
  const gesture = useRef<{ id: number; startY: number; startPower: number } | null>(null);
  const currentPower = useRef(power);
  currentPower.current = power;
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      const active = gesture.current;
      if (event.key !== 'Escape' || !active) return;
      gesture.current = null;
      currentPower.current = active.startPower;
      onPowerChange(active.startPower);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [onPowerChange]);
  const setFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    const next = Math.max(0.04, Math.min(1, active.startPower + (active.startY - event.clientY) / 150));
    currentPower.current = next;
    onPowerChange(next);
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    if (!gesture.current || gesture.current.id !== event.pointerId) return;
    if (commit) setFromPointer(event);
    else {
      currentPower.current = gesture.current.startPower;
      onPowerChange(gesture.current.startPower);
    }
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const cancelGesture = (event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active) return;
    event.preventDefault();
    gesture.current = null;
    currentPower.current = active.startPower;
    onPowerChange(active.startPower);
    if (event.currentTarget.hasPointerCapture(active.id)) event.currentTarget.releasePointerCapture(active.id);
  };
  const style = { '--power': `${power * 100}%`, '--power-color': strikeVelocityColor(power) } as CSSProperties;
  return <section className="strike-control" style={style}>
    <button
      className="velocity-triangle" type="button" disabled={disabled} role="slider" aria-label={`Strike velocity, ${Math.round(power * 100)} percent`}
      aria-valuemin={4} aria-valuemax={100} aria-valuenow={Math.round(power * 100)}
      onPointerDown={(event) => {
        event.preventDefault();
        if (event.button === 2) { cancelGesture(event); return; }
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { id: event.pointerId, startY: event.clientY, startPower: power };
      }}
      onPointerMove={setFromPointer} onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)}
      onContextMenu={(event) => { event.preventDefault(); cancelGesture(event); }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.01 : 0.02;
        if (event.key === 'ArrowUp') onPowerChange(Math.min(1, power + step));
        else if (event.key === 'ArrowDown') onPowerChange(Math.max(0.04, power - step));
        else return;
        event.preventDefault();
      }}
    >
      <i className="strike-endstop low" /><i className="strike-power-track"><b /></i><i className="strike-endstop high" />
      <span className="strike-label">VELOCITY</span>
      <strong className="strike-velocity-value"><span>{Math.round(power * 100)}</span><small>%</small></strong>
      <i className="strike-drag-arrow" aria-hidden="true"><b /></i>
      <small className="strike-hint">DRAG TO SET · THEN STRIKE · RIGHT-CLICK CANCEL</small>
    </button>
    <button className="strike-button explicit-strike" type="button" disabled={disabled} onClick={() => onStrike(power)}><span>{label}</span><i aria-hidden="true">↑</i></button>
    <button className="reset-shot-button" type="button" disabled={disabled} onClick={onReset}>Reset shot</button>
  </section>;
}
