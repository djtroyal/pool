/// <reference lib="webworker" />
import { predictTrajectory, type BallState, type ShotInput, type TrajectoryPredictionConfig } from '@breakroom/game-core';

interface PreviewRequest {
  requestId: number;
  balls: BallState[];
  shot: ShotInput;
  config: TrajectoryPredictionConfig;
}

self.onmessage = (message: MessageEvent<PreviewRequest>) => {
  const { requestId, balls, shot, config } = message.data;
  self.postMessage({ requestId, preview: predictTrajectory(balls, shot, config) });
};

export {};
