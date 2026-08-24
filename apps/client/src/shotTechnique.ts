import type { SpinInput } from '@breakroom/game-core';

export function describeShotTechnique(elevation: number, english: SpinInput): string {
  const side = Math.abs(english.side) < 0.12 ? 0 : english.side;
  const vertical = Math.abs(english.vertical) < 0.12 ? 0 : english.vertical;
  const direction = side < 0 ? 'Left' : 'Right';

  if (elevation >= 50) return side ? `${direction} massé` : 'Massé';
  if (elevation >= 28) return side ? `${direction}-English jump` : 'Jump shot';
  if (elevation >= 10) return side ? `${direction} swerve` : 'Elevated shot';

  if (side && vertical > 0) return `Follow with ${direction.toLowerCase()} English`;
  if (side && vertical < 0) return `Draw with ${direction.toLowerCase()} English`;
  if (side) return `${direction} English`;
  if (vertical >= 0.18) return 'Follow';
  if (vertical <= -0.48) return 'Draw';
  if (vertical < 0) return 'Stun';
  return 'Center ball';
}

export function strikeVelocityColor(power: number): string {
  const normalized = Math.max(0, Math.min(1, power));
  const hue = normalized <= 0.5
    ? 155 + (45 - 155) * (normalized / 0.5)
    : 45 + (4 - 45) * ((normalized - 0.5) / 0.5);
  return `hsl(${Math.round(hue)} 78% 58%)`;
}
