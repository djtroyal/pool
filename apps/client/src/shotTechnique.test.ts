import { describe, expect, it } from 'vitest';
import { describeShotTechnique, strikeVelocityColor } from './shotTechnique.js';

describe('shot technique classification', () => {
  it('classifies ordinary center-axis shots', () => {
    expect(describeShotTechnique(0, { side: 0, vertical: 0 })).toBe('Center ball');
    expect(describeShotTechnique(0, { side: 0, vertical: -0.25 })).toBe('Stun');
    expect(describeShotTechnique(0, { side: 0, vertical: -0.7 })).toBe('Draw');
    expect(describeShotTechnique(0, { side: 0, vertical: 0.7 })).toBe('Follow');
  });

  it('combines side English with follow and draw', () => {
    expect(describeShotTechnique(0, { side: -0.5, vertical: 0.5 })).toBe('Follow with left English');
    expect(describeShotTechnique(0, { side: 0.5, vertical: -0.5 })).toBe('Draw with right English');
  });

  it('uses elevation to identify swerve, jump, and massé shots', () => {
    expect(describeShotTechnique(18, { side: -0.5, vertical: 0 })).toBe('Left swerve');
    expect(describeShotTechnique(38, { side: 0, vertical: 0 })).toBe('Jump shot');
    expect(describeShotTechnique(60, { side: 0.7, vertical: -0.2 })).toBe('Right massé');
  });
});

describe('strike velocity color', () => {
  it('progresses from soft green through warning gold to break red', () => {
    expect(strikeVelocityColor(0)).toBe('hsl(155 78% 58%)');
    expect(strikeVelocityColor(0.5)).toBe('hsl(45 78% 58%)');
    expect(strikeVelocityColor(1)).toBe('hsl(4 78% 58%)');
  });

  it('clamps values outside the velocity range', () => {
    expect(strikeVelocityColor(-1)).toBe(strikeVelocityColor(0));
    expect(strikeVelocityColor(2)).toBe(strikeVelocityColor(1));
  });
});
