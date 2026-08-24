/// <reference lib="webworker" />
import {
  optimizePracticeShot,
  type ShotOptimizerProgress,
  type ShotOptimizerRequest,
  type ShotOptimizerResult
} from '@breakroom/game-core';

interface OptimizerWorkerRequest {
  requestId: number;
  request: ShotOptimizerRequest;
}

export type OptimizerWorkerResponse =
  | { requestId: number; kind: 'progress'; progress: ShotOptimizerProgress }
  | { requestId: number; kind: 'result'; result: ShotOptimizerResult | null }
  | { requestId: number; kind: 'error'; message: string };

self.onmessage = (message: MessageEvent<OptimizerWorkerRequest>) => {
  const { requestId, request } = message.data;
  try {
    const result = optimizePracticeShot(request, (progress) => {
      self.postMessage({ requestId, kind: 'progress', progress } satisfies OptimizerWorkerResponse);
    });
    self.postMessage({ requestId, kind: 'result', result } satisfies OptimizerWorkerResponse);
  } catch (error) {
    self.postMessage({
      requestId,
      kind: 'error',
      message: error instanceof Error ? error.message : 'Shot optimization failed.'
    } satisfies OptimizerWorkerResponse);
  }
};

export {};
