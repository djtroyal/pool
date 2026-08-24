import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  COSMETIC_CATALOG,
  PRACTICE_CHALLENGES,
  createGame,
  createNextRack,
  isValidPlacement,
  placeBall,
  practiceStateFingerprint,
  resolveShot,
  simulateShot,
  type BallState,
  type CalledShot,
  type ClothDesignId,
  type ClothSpeed,
  type GameMode,
  type GameSnapshot,
  type PlayerProfile,
  type PracticeChallengeAttempt,
  type PracticeChallengeId,
  type PracticeChallengeResult,
  type ShotInput,
  type ShotOptimizerProgress,
  type ShotOptimizerQuality,
  type ShotOptimizerResult,
  type ShotPlayback,
  type SpinInput,
  type TableDesignId,
  type TrajectoryAidFlags,
  type Vec2
} from '@breakroom/game-core';
import type { OptimizerWorkerResponse } from '../workers/optimizer.worker.js';
import { playProgressSound, playShotPlayback } from '../audio.js';
import { socket } from '../socket.js';
import { describeShotTechnique } from '../shotTechnique.js';
import { loadTrajectoryAids, loadTrajectoryDepth, saveTrajectoryAids, saveTrajectoryDepth } from '../trajectory.js';
import { PocketedBallTray, type PocketedBallDrag } from './PocketedBallTray.js';
import { PoolTable, type PoolTableHandle } from './PoolTable.js';
import { SpinControl } from './SpinControl.js';
import { TrajectoryControls } from './TrajectoryControls.js';
import { StrikeControl } from './StrikeControl.js';

interface PracticeProps {
  profile: PlayerProfile | null;
  onProfile: (profile: PlayerProfile) => void;
  onClose: () => void;
  initialGame?: GameSnapshot | null | undefined;
}
interface SandboxPermissions {
  moveObjectBalls: boolean;
  moveCueBall: boolean;
  legalPlacementOnly: boolean;
  restoreBalls: boolean;
  undo: boolean;
  repeat: boolean;
}

const DEFAULT_PERMISSIONS: SandboxPermissions = {
  moveObjectBalls: true, moveCueBall: true, legalPlacementOnly: false,
  restoreBalls: true, undo: true, repeat: true
};


function freshPractice(mode: GameMode, sandbox: boolean): GameSnapshot {
  const game = createGame({ ...DEFAULT_SETTINGS, mode }, 0);
  return sandbox ? { ...game, ballInHand: false, placement: null, scores: [0, 0] } : game;
}

function shotControlSignature(shot: Pick<ShotInput, 'angle' | 'power' | 'elevation' | 'english'>): string {
  return [shot.angle.toFixed(8), shot.power.toFixed(4), shot.elevation.toFixed(2),
    shot.english.side.toFixed(4), shot.english.vertical.toFixed(4)].join('|');
}

type OptimizerStage = 'idle' | 'primary-ready' | 'waiting-for-settle' | 'follow-up-ready';

export function Practice({ profile, onProfile, onClose, initialGame = null }: PracticeProps) {
  const [mode, setMode] = useState<GameMode>(initialGame?.mode ?? 'eight-ball');
  const [sandbox, setSandbox] = useState(true);
  const [permissions, setPermissions] = useState<SandboxPermissions>(DEFAULT_PERMISSIONS);
  const [game, setGame] = useState(() => initialGame ? { ...structuredClone(initialGame), phase: 'aiming' as const, winnerIndex: null, shotClockEndsAt: null } : freshPractice('eight-ball', true));
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.5);
  const [elevation, setElevation] = useState(0);
  const [english, setEnglish] = useState<SpinInput>({ side: 0, vertical: 0 });
  const [trajectoryAids, setTrajectoryAids] = useState<TrajectoryAidFlags>(loadTrajectoryAids);
  const [trajectoryDepth, setTrajectoryDepth] = useState(loadTrajectoryDepth);
  const [ghostTrails, setGhostTrails] = useState(() => localStorage.getItem('breakroom:trails') === 'on');
  const [clothSpeed, setClothSpeed] = useState<ClothSpeed>('standard');
  const [tableDesign, setTableDesign] = useState<TableDesignId>(profile?.loadout.tableFinish ?? 'classic-walnut');
  const [clothDesign, setClothDesign] = useState<ClothDesignId>(profile?.loadout.cloth ?? 'emerald-solid');
  const [customClothColor, setCustomClothColor] = useState('#0c624a');
  const [playback, setPlayback] = useState<ShotPlayback | null>(null);
  const [now, setNow] = useState(Date.now());
  const [undoStack, setUndoStack] = useState<GameSnapshot[]>([]);
  const [lastShot, setLastShot] = useState<{ before: GameSnapshot; shot: ShotInput } | null>(null);
  const [placementBallId, setPlacementBallId] = useState<number | null>(null);
  const [trayDrag, setTrayDrag] = useState<PocketedBallDrag | null>(null);
  const [challenge, setChallenge] = useState<PracticeChallengeAttempt | null>(null);
  const [challengeResult, setChallengeResult] = useState<PracticeChallengeResult | null>(null);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [optimizerQuality, setOptimizerQuality] = useState<ShotOptimizerQuality>(() => {
    const saved = localStorage.getItem('breakroom:optimizer-quality');
    return saved === 'fast' || saved === 'deep' ? saved : 'balanced';
  });
  const [optimizerBusy, setOptimizerBusy] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState<ShotOptimizerProgress | null>(null);
  const [optimizerResult, setOptimizerResult] = useState<ShotOptimizerResult | null>(null);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [optimizerStage, setOptimizerStage] = useState<OptimizerStage>('idle');
  const [optimizedCalledShot, setOptimizedCalledShot] = useState<CalledShot | null>(null);
  const [pendingFollowUp, setPendingFollowUp] = useState<{ shot: ShotInput; expectedFingerprint: string } | null>(null);
  const clearTimer = useRef<number | null>(null);
  const challengeRevealTimer = useRef<number | null>(null);
  const tableRef = useRef<PoolTableHandle>(null);
  const optimizerWorkerRef = useRef<Worker | null>(null);
  const optimizerMenuRef = useRef<HTMLDetailsElement | null>(null);
  const optimizerRequestRef = useRef(0);
  const optimizerSearchControlsRef = useRef<string | null>(null);
  const optimizedControlsRef = useRef<string | null>(null);
  const liveGameFingerprintRef = useRef(practiceStateFingerprint(game));
  liveGameFingerprintRef.current = practiceStateFingerprint(game);

  const stopOptimizer = useCallback((clearResult = true) => {
    optimizerWorkerRef.current?.terminate();
    optimizerWorkerRef.current = null;
    optimizerRequestRef.current += 1;
    optimizerSearchControlsRef.current = null;
    setOptimizerBusy(false);
    setOptimizerProgress(null);
    if (!clearResult) return;
    optimizedControlsRef.current = null;
    setOptimizerResult(null);
    setOptimizerStage('idle');
    setOptimizedCalledShot(null);
    setPendingFollowUp(null);
    setOptimizerError(null);
  }, []);

  const applyOptimizedControls = useCallback((shot: ShotInput, stage: OptimizerStage) => {
    optimizedControlsRef.current = shotControlSignature(shot);
    setAngle(shot.angle);
    setPower(shot.power);
    setElevation(shot.elevation);
    setEnglish(shot.english);
    setOptimizedCalledShot(shot.calledShot ?? null);
    setOptimizerStage(stage);
  }, []);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    if (challengeRevealTimer.current) window.clearTimeout(challengeRevealTimer.current);
    optimizerWorkerRef.current?.terminate();
  }, []);
  useEffect(() => {
    if (sandbox && permissions.restoreBalls) return;
    setPlacementBallId(null);
    setTrayDrag(null);
  }, [permissions.restoreBalls, sandbox]);
  const inMotion = Boolean(playback && now < playback.startedAt + playback.durationMs);
  const canConfigureShot = !inMotion && !challengeBusy && !challengeResult && game.phase === 'aiming' && (!game.ballInHand || game.breakShot);
  const currentControlSignature = shotControlSignature({ angle, power, elevation, english });

  useEffect(() => {
    if (optimizerBusy && optimizerSearchControlsRef.current !== currentControlSignature) stopOptimizer();
    if (!inMotion && (optimizerStage === 'primary-ready' || optimizerStage === 'follow-up-ready')
      && optimizedControlsRef.current !== currentControlSignature) stopOptimizer();
  }, [currentControlSignature, inMotion, optimizerBusy, optimizerStage, stopOptimizer]);

  useEffect(() => {
    if (!pendingFollowUp || inMotion || !playback) return;
    if (practiceStateFingerprint(game) === pendingFollowUp.expectedFingerprint) {
      applyOptimizedControls({ ...pendingFollowUp.shot, revision: game.revision }, 'follow-up-ready');
      setOptimizerError(null);
    } else {
      setOptimizerError('The table settled differently, so the follow-up recommendation was discarded.');
      optimizedControlsRef.current = null;
      setOptimizerResult(null);
      setOptimizerStage('idle');
      setOptimizedCalledShot(null);
    }
    setPendingFollowUp(null);
  }, [applyOptimizedControls, game, inMotion, pendingFollowUp, playback]);

  const rerack = useCallback((nextMode = mode, nextSandbox = sandbox) => {
    stopOptimizer();
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    if (challengeRevealTimer.current) window.clearTimeout(challengeRevealTimer.current);
    setMode(nextMode); setGame(freshPractice(nextMode, nextSandbox)); setPlayback(null); setUndoStack([]); setLastShot(null); setPlacementBallId(null); setTrayDrag(null); setChallenge(null); setChallengeResult(null); setChallengeError(null);
  }, [mode, sandbox, stopOptimizer]);

  const startChallenge = useCallback((challengeId: PracticeChallengeId) => {
    stopOptimizer();
    if (challengeRevealTimer.current) window.clearTimeout(challengeRevealTimer.current);
    setChallengeBusy(true); setChallengeError(null); setChallengeResult(null);
    socket.emit('practice:challenge-start', { challengeId }, (result) => {
      setChallengeBusy(false);
      if (!result.ok) { setChallengeError(result.message); return; }
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      setChallenge(result.data); setMode(result.data.game.mode); setSandbox(false); setGame(result.data.game);
      setPlayback(null); setUndoStack([]); setLastShot(null); setPlacementBallId(null); setTrayDrag(null);
      setAngle(0); setPower(challengeId === 'break-lab' ? 0.9 : 0.48); setElevation(0); setEnglish({ side: 0, vertical: 0 });
    });
  }, [stopOptimizer]);

  const launchOptimizer = useCallback(() => {
    if (inMotion || challengeBusy || challengeResult || game.phase !== 'aiming' || game.ballInHand) return;
    stopOptimizer();
    const requestId = ++optimizerRequestRef.current;
    const sourceFingerprint = practiceStateFingerprint(game);
    optimizerSearchControlsRef.current = currentControlSignature;
    const worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
    optimizerWorkerRef.current = worker;
    setOptimizerBusy(true);
    setOptimizerError(null);
    setOptimizerProgress({ phase: 'first-shot', evaluated: 0, total: 1, bestNow: 0, bestNext: 0 });
    worker.onmessage = (message: MessageEvent<OptimizerWorkerResponse>) => {
      if (message.data.requestId !== requestId || optimizerWorkerRef.current !== worker) return;
      if (message.data.kind === 'progress') {
        setOptimizerProgress(message.data.progress);
        return;
      }
      worker.terminate();
      optimizerWorkerRef.current = null;
      optimizerSearchControlsRef.current = null;
      setOptimizerBusy(false);
      setOptimizerProgress(null);
      if (message.data.kind === 'error') {
        setOptimizerError(message.data.message);
        return;
      }
      if (liveGameFingerprintRef.current !== sourceFingerprint) return;
      const result = message.data.result;
      if (!result) {
        setOptimizerError('No legal shot could be found from this layout.');
        return;
      }
      if (!sandbox && !result.primary.rackWin && result.primary.ownedPots.length === 0 && !result.followUp) {
        setOptimizerError('No continuing legal pot was found. Your shot controls were left unchanged.');
        return;
      }
      setOptimizerResult(result);
      applyOptimizedControls(result.primary.shot, 'primary-ready');
      if (optimizerMenuRef.current) optimizerMenuRef.current.open = false;
    };
    worker.onerror = () => {
      if (optimizerWorkerRef.current !== worker) return;
      worker.terminate(); optimizerWorkerRef.current = null;
      optimizerSearchControlsRef.current = null;
      setOptimizerBusy(false); setOptimizerProgress(null);
      setOptimizerError('The optimizer worker stopped unexpectedly.');
    };
    worker.postMessage({
      requestId,
      request: {
        game,
        config: { clothSpeed: challenge ? 'standard' : clothSpeed },
        quality: optimizerQuality,
        sandbox,
        initialShot: { revision: game.revision, angle, power, elevation, english }
      }
    });
  }, [angle, applyOptimizedControls, challenge, challengeBusy, challengeResult, clothSpeed, currentControlSignature, elevation, english, game, inMotion, optimizerQuality, power, sandbox, stopOptimizer]);

  const startOptimizer = useCallback(() => {
    if (!challenge || challenge.assisted) { launchOptimizer(); return; }
    if (!window.confirm('Use optimizer assistance for this drill? This attempt will become unscored and cannot award XP, medals, personal bests, or unlocks.')) return;
    setChallengeBusy(true); setChallengeError(null);
    socket.emit('practice:challenge-assist', { attemptId: challenge.attemptId }, (result) => {
      setChallengeBusy(false);
      if (!result.ok) { setChallengeError(result.message); return; }
      setChallenge((current) => current ? { ...current, assisted: true } : current);
      launchOptimizer();
    });
  }, [challenge, launchOptimizer]);

  const runShot = useCallback((before: GameSnapshot, shot: ShotInput, addUndo: boolean) => {
    const simulation = simulateShot(before.balls, shot, { clothSpeed });
    const rulesResult = resolveShot(before, simulation, shot);
    const finalSnapshot: GameSnapshot = sandbox
      ? { ...rulesResult, phase: 'aiming', turnIndex: 0, winnerIndex: null, scores: [0, 0], shotClockEndsAt: null }
      : rulesResult;
    const recommendedLine = optimizerStage === 'primary-ready' ? optimizerResult?.primary
      : optimizerStage === 'follow-up-ready' ? optimizerResult?.followUp : null;
    const callMatches = (recommendedLine?.shot.calledShot?.ballId ?? null) === (shot.calledShot?.ballId ?? null)
      && (recommendedLine?.shot.calledShot?.pocketId ?? null) === (shot.calledShot?.pocketId ?? null);
    const matchesRecommendation = Boolean(recommendedLine
      && shotControlSignature(recommendedLine.shot) === shotControlSignature(shot) && callMatches);
    if (matchesRecommendation && optimizerStage === 'primary-ready' && optimizerResult?.followUp && !challenge) {
      if (practiceStateFingerprint(finalSnapshot) === optimizerResult.primary.afterFingerprint) {
        setPendingFollowUp({ shot: optimizerResult.followUp.shot, expectedFingerprint: optimizerResult.primary.afterFingerprint });
        setOptimizerStage('waiting-for-settle');
        optimizedControlsRef.current = null;
      } else {
        stopOptimizer();
        setOptimizerError('The optimized table state did not match, so its follow-up was discarded.');
      }
    } else {
      stopOptimizer();
    }
    const startedAt = Date.now() + 60;
    const nextPlayback: ShotPlayback = {
      id: crypto.randomUUID(), startedAt, durationMs: Math.ceil(simulation.trace.duration * 1000),
      shot, initialBalls: before.balls, frames: simulation.frames, trace: simulation.trace, finalSnapshot, scoreEvent: null
    };
    if (addUndo && (!sandbox || permissions.undo)) setUndoStack((stack) => [...stack.slice(-19), before]);
    setLastShot({ before, shot }); setGame(finalSnapshot); setPlayback(nextPlayback);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setPlayback(null), nextPlayback.durationMs + 1_500);
  }, [challenge, clothSpeed, optimizerResult, optimizerStage, permissions.undo, sandbox, stopOptimizer]);

  useEffect(() => playback ? playShotPlayback(playback, profile?.loadout.soundSet) : undefined, [playback?.id, profile?.loadout.soundSet]);

  useEffect(() => {
    if (!playback) return;
    setEnglish({ side: 0, vertical: 0 });
    setElevation(0);
  }, [playback?.id]);

  const shoot = useCallback((shotPower = power) => {
    if (inMotion || challengeBusy || challengeResult || game.ballInHand || game.phase !== 'aiming') return;
    const recommendationActive = optimizedControlsRef.current === currentControlSignature;
    const shot = {
      revision: game.revision, angle, power: shotPower, elevation, english,
      calledShot: recommendationActive ? optimizedCalledShot : null
    };
    if (challenge) {
      setChallengeBusy(true); setChallengeError(null);
      socket.emit('practice:challenge-submit', { attemptId: challenge.attemptId, shot }, (result) => {
        setChallengeBusy(false);
        if (!result.ok) { setChallengeError(result.message); return; }
        setPlayback(result.data.playback); setGame(result.data.playback.finalSnapshot);
        const revealDelay = Math.max(0, result.data.playback.startedAt + result.data.playback.durationMs - Date.now()) + 90;
        challengeRevealTimer.current = window.setTimeout(() => {
          setChallengeResult(result.data); onProfile(result.data.profile);
          playProgressSound(result.data.assisted ? 'score' : result.data.unlocks.length ? 'unlock' : result.data.medal === 3 ? 'rank' : 'score', result.data.profile.loadout.stinger);
          challengeRevealTimer.current = null;
        }, revealDelay);
        if (clearTimer.current) window.clearTimeout(clearTimer.current);
        clearTimer.current = window.setTimeout(() => setPlayback(null), result.data.playback.durationMs + 1_500);
      });
      stopOptimizer();
      return;
    }
    runShot(game, shot, true);
  }, [angle, challenge, challengeBusy, challengeResult, currentControlSignature, elevation, english, game, inMotion, onProfile, optimizedCalledShot, power, runShot, stopOptimizer]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (inMotion || challengeBusy || challengeResult || game.phase !== 'aiming' || ['INPUT', 'SELECT', 'BUTTON'].includes((event.target as HTMLElement).tagName)) return;
      const angleStep = (event.shiftKey ? 0.1 : 1) * Math.PI / 180;
      const powerStep = 0.01;
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') setAngle((value) => value - angleStep);
      else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') setAngle((value) => value + angleStep);
      else if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') setPower((value) => Math.min(1, value + powerStep));
      else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') setPower((value) => Math.max(0.04, value - powerStep));
      else if (event.key.toLowerCase() === 'c') setEnglish({ side: 0, vertical: 0 });
      else if (event.code === 'Space') shoot();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [challengeBusy, challengeResult, game.phase, inMotion, shoot]);

  const canMove = (ball: BallState) => sandbox && (ball.id === 0 ? permissions.moveCueBall : permissions.moveObjectBalls);
  const moveBall = (id: number, point: Vec2) => {
    stopOptimizer();
    const placementGame = permissions.legalPlacementOnly ? game : { ...game, placement: null };
    if (!isValidPlacement(placementGame, point, id)) return;
    if (permissions.undo) setUndoStack((stack) => [...stack.slice(-19), game]);
    setGame((current) => ({
      ...current, revision: current.revision + 1,
      balls: current.balls.map((ball) => ball.id === id ? { ...ball, ...point, z: 0.028575, disposition: 'on-table' as const, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 } : ball),
      pocketedOrder: current.pocketedOrder.filter((ballId) => ballId !== id),
      ballInHand: id === 0 ? false : current.ballInHand,
      placement: id === 0 ? null : current.placement
    }));
  };

  const placePocketedBall = (id: number, point: Vec2) => {
    const placementGame = permissions.legalPlacementOnly ? game : { ...game, placement: null };
    if (!isValidPlacement(placementGame, point, id)) return;
    moveBall(id, point); setPlacementBallId(null);
  };

  const cancelTrayDrag = () => { setTrayDrag(null); setPlacementBallId(null); };
  const dropPocketedBall = (drag: PocketedBallDrag) => {
    const point = tableRef.current?.pointFromClient(drag.clientX, drag.clientY) ?? null;
    if (point) placePocketedBall(drag.id, point);
    cancelTrayDrag();
  };

  const undo = () => {
    const previous = undoStack.at(-1); if (!previous) return;
    stopOptimizer();
    setGame(previous); setUndoStack((stack) => stack.slice(0, -1)); setPlayback(null);
  };

  const toggleSandbox = () => {
    stopOptimizer();
    if (challenge) { rerack(mode, true); setSandbox(true); return; }
    if (sandbox) {
      if (!window.confirm('Disable Sandbox and start a fresh rules game? The current drill and undo history will be cleared.')) return;
      setSandbox(false); rerack(mode, false);
    } else {
      setSandbox(true); setUndoStack([]); setLastShot(null);
      setGame((current) => ({ ...current, phase: 'aiming', ballInHand: false, placement: null, winnerIndex: null }));
    }
  };

  const optimizerPhase = optimizerProgress?.phase === 'first-shot' ? 'first shot'
    : optimizerProgress?.phase === 'follow-up' ? 'follow-up' : 'robustness';
  const optimizerPercent = optimizerProgress ? Math.min(99, Math.round(optimizerProgress.evaluated / Math.max(1, optimizerProgress.total) * 100)) : 0;
  const playStatus = optimizerBusy ? `Optimizing ${optimizerPhase}… ${optimizerPercent}%`
    : optimizerStage === 'primary-ready' && optimizerResult ? `Optimized: ${optimizerResult.primary.ownedPots.length} now · ${optimizerResult.followUp?.ownedPots.length ?? 0} next`
      : optimizerStage === 'follow-up-ready' && optimizerResult ? `Optimized follow-up: ${optimizerResult.followUp?.ownedPots.length ?? 0} pots`
        : challengeBusy ? 'Verifying shot…' : challengeResult ? `${challengeResult.score} points` : placementBallId !== null
    ? `Place the ${placementBallId} ball`
    : inMotion ? 'Balls in motion…' : game.lastEvents.at(-1)?.message ?? 'Ready';

  useEffect(() => {
    document.title = `Practice — ${playStatus} | Breakroom`;
    return () => { document.title = 'Breakroom'; };
  }, [playStatus]);

  return (
    <main className="practice-shell">
      <header className="game-header">
        <button className="game-brand" type="button" onClick={onClose}><span className="wordmark-ball">8</span><span>BREAKROOM</span></button>
        <div className="match-label"><span>SOLO · PRACTICE</span><strong>{playStatus}</strong></div>
        <div className="header-actions">
          <TrajectoryControls value={trajectoryAids} ghostTrails={ghostTrails} rebounds={trajectoryDepth.rebounds} impacts={trajectoryDepth.impacts} onDepthChange={(next) => { setTrajectoryDepth(next); saveTrajectoryDepth(next); }} onChange={(next) => { setTrajectoryAids(next); saveTrajectoryAids(next); }} onGhostTrailsChange={(enabled) => { setGhostTrails(enabled); localStorage.setItem('breakroom:trails', enabled ? 'on' : 'off'); }} />
          <details className="table-options-dropdown"><summary>Table</summary><div><label>Cloth speed<select value={challenge ? 'standard' : clothSpeed} disabled={Boolean(challenge)} onChange={(event) => { stopOptimizer(); setClothSpeed(event.target.value as ClothSpeed); }}><option value="very-slow">Very slow</option><option value="slow">Slow</option><option value="standard">Standard</option><option value="fast">Fast</option><option value="very-fast">Very fast</option></select></label><label>Frame<select value={tableDesign} onChange={(event) => setTableDesign(event.target.value as TableDesignId)}>{COSMETIC_CATALOG.filter((item) => item.category === 'tableFinish' && profile?.unlocks.includes(item.id)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Cloth<select value={clothDesign} onChange={(event) => setClothDesign(event.target.value as ClothDesignId)}>{COSMETIC_CATALOG.filter((item) => item.category === 'cloth' && profile?.unlocks.includes(item.id)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{clothDesign === 'custom-solid' && <label>Color<input aria-label="Custom cloth color" type="color" value={customClothColor} onChange={(event) => setCustomClothColor(event.target.value)} /></label>}</div></details>
          <button className="leave-match" type="button" onClick={onClose}>Exit</button>
        </div>
      </header>
      <section className="practice-toolbar">
        <label className="challenge-select"><span>Drill</span><select aria-label="Practice drill" value={challenge?.definition.id ?? 'open'} disabled={challengeBusy || inMotion} onChange={(event) => event.target.value === 'open' ? rerack(mode, true) : startChallenge(event.target.value as PracticeChallengeId)}><option value="open">Open table</option>{PRACTICE_CHALLENGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <div className="mode-toggle"><button className={mode === 'eight-ball' ? 'active' : ''} type="button" onClick={() => rerack('eight-ball')}>8-Ball</button><button className={mode === 'nine-ball' ? 'active' : ''} type="button" onClick={() => rerack('nine-ball')}>9-Ball</button></div>
        <details className="optimizer-menu" ref={optimizerMenuRef}>
          <summary>{optimizerBusy ? `Optimizing ${optimizerPercent}%` : 'Optimizer'}</summary>
          <div className="optimizer-popover">
            <header><span>Shot optimizer</span><small>{game.mode === 'nine-ball' ? 'Rotation' : game.groups[game.turnIndex] ? game.groups[game.turnIndex] : game.breakShot ? 'Auto · provisional group' : 'Auto · open table'}</small></header>
            <label>Search quality<select aria-label="Optimizer quality" value={optimizerQuality} disabled={optimizerBusy} onChange={(event) => { stopOptimizer(); const next = event.target.value as ShotOptimizerQuality; setOptimizerQuality(next); localStorage.setItem('breakroom:optimizer-quality', next); }}><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="deep">Deep</option></select></label>
            {optimizerProgress && <div className="optimizer-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={optimizerPercent}><i style={{ width: `${optimizerPercent}%` }} /><span>{optimizerPhase} · {optimizerProgress.evaluated}/{optimizerProgress.total}</span></div>}
            {challenge?.assisted && <small className="optimizer-assisted">ASSISTED DRILL · UNSCORED</small>}
            {optimizerResult && <p><strong>{optimizerResult.target === 'rotation' ? 'ROTATION' : optimizerResult.target.toUpperCase()}{optimizerResult.provisionalTarget ? ' · PROVISIONAL' : ''}</strong><span>{optimizerResult.primary.ownedPots.length} now · {optimizerResult.followUp?.ownedPots.length ?? 0} next · {optimizerResult.robustness}% robust</span></p>}
            {optimizerError && <p className="optimizer-error" role="alert">{optimizerError}</p>}
            <button className="optimizer-action" type="button" disabled={!optimizerBusy && (inMotion || challengeBusy || Boolean(challengeResult) || game.phase !== 'aiming' || game.ballInHand)} onClick={() => optimizerBusy ? stopOptimizer() : startOptimizer()}>{optimizerBusy ? 'Cancel search' : 'Find best shot'}</button>
          </div>
        </details>
        <div className="practice-actions"><button type="button" disabled={Boolean(challenge) || !undoStack.length || inMotion || (sandbox && !permissions.undo)} onClick={undo}>↶ Undo</button><button type="button" disabled={Boolean(challenge) || !lastShot || inMotion || (sandbox && !permissions.repeat)} onClick={() => lastShot && runShot(lastShot.before, lastShot.shot, false)}>↻ Repeat</button><button type="button" disabled={inMotion || challengeBusy} onClick={() => challenge ? startChallenge(challenge.definition.id) : rerack()}>◇ Reset</button>{!challenge && !sandbox && game.phase === 'rack-over' && <button type="button" onClick={() => { stopOptimizer(); setGame(createNextRack(game)); }}>Next rack</button>}</div>
        <details className="sandbox-settings"><summary>Settings</summary><div><label className="toggle-row"><input type="checkbox" checked={sandbox} disabled={challengeBusy} onChange={toggleSandbox} /><span>Sandbox editing</span></label>{sandbox && (Object.keys(permissions) as Array<keyof SandboxPermissions>).map((key) => <label className="toggle-row" key={key}><input type="checkbox" checked={permissions[key]} onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })} /><span>{({ moveObjectBalls: 'Move object balls', moveCueBall: 'Move cue ball anytime', legalPlacementOnly: 'Legal cue placement only', restoreBalls: 'Restore removed balls', undo: 'Allow undo', repeat: 'Allow repeat' } as Record<keyof SandboxPermissions, string>)[key]}</span></label>)}</div></details>
      </section>

      <section className="game-layout practice-layout">
        <aside className="cue-panel" aria-label="Shot controls">
          <SpinControl value={english} angle={angle} elevation={elevation} shotType={describeShotTechnique(elevation, english)} elevationLabel="Practice cue elevation" disabled={!canConfigureShot} elevationDisabled={inMotion} onChange={setEnglish} onAngleChange={setAngle} onElevationChange={setElevation} />
          <StrikeControl power={power} disabled={optimizerBusy || inMotion || challengeBusy || Boolean(challengeResult) || game.ballInHand || game.phase !== 'aiming'} label={game.ballInHand ? 'PLACE CUE BALL' : optimizerBusy ? 'OPTIMIZING' : challengeBusy ? 'VERIFYING' : inMotion ? 'BALLS IN MOTION' : 'STRIKE'} onPowerChange={setPower} onStrike={shoot} onReset={() => { setEnglish({ side: 0, vertical: 0 }); setElevation(0); setPower(0.5); }} />
        </aside>
        <div className="table-stack">
        <div className="table-column">
          <PoolTable ref={tableRef} game={game} playback={playback} angle={angle} power={power} elevation={elevation} english={english} interactive={!inMotion && !challengeBusy && !challengeResult && game.phase === 'aiming'} trajectoryAids={trajectoryAids} reboundDepth={trajectoryDepth.rebounds} impactDepth={trajectoryDepth.impacts} clothSpeed={challenge ? 'standard' : clothSpeed} tableDesign={tableDesign} clothDesign={clothDesign} customClothColor={customClothColor} ghostTrails={ghostTrails} cueStyle={profile?.loadout.cue} cueBallStyle={profile?.loadout.cueBall} ballSetStyle={profile?.loadout.ballSet} trailStyle={profile?.loadout.trail} placementBallId={placementBallId} externalDraggedBall={trayDrag} futurePots={optimizerStage === 'primary-ready' ? optimizerResult?.followUp?.pots ?? [] : []} selectedCallBallId={optimizedCalledShot?.ballId} selectedPocketId={optimizedCalledShot?.pocketId} canMoveBall={canMove} onAngleChange={setAngle} onPowerChange={setPower} onPowerGestureStrike={shoot} onPlaceCue={(point) => { stopOptimizer(); setGame((current) => placeBall(current, point)); }} onPlaceBall={placePocketedBall} onMoveBall={moveBall} />
          {optimizerResult && optimizerStage !== 'idle' && <section className={`optimizer-result-overlay ${optimizerStage}`} aria-live="polite"><strong>{optimizerStage === 'follow-up-ready' ? 'FOLLOW-UP STAGED' : optimizerStage === 'waiting-for-settle' ? 'VERIFYING LEAVE' : 'OPTIMIZED SHOT READY'}</strong><span>{optimizerResult.target === 'rotation' ? 'Rotation' : `${optimizerResult.target[0]!.toUpperCase()}${optimizerResult.target.slice(1)}`}{optimizerResult.provisionalTarget ? ' · provisional' : ''} · {optimizerStage === 'follow-up-ready' ? optimizerResult.followUp?.ownedPots.length ?? 0 : optimizerResult.primary.ownedPots.length} pots</span><small>{optimizerStage === 'primary-ready' ? `${optimizerResult.followUp?.ownedPots.length ?? 0} predicted next · ${optimizerResult.robustness}% robust` : optimizerStage === 'waiting-for-settle' ? 'Follow-up loads only if the table matches' : 'Review the aids, then strike'}</small></section>}
          {challenge && !challengeResult && <section className="drill-instructions" aria-label="Drill instructions"><strong>{challenge.definition.name}</strong><span>{challenge.definition.description}</span><small>{challenge.definition.objective}</small></section>}
          {challengeResult && <section className={`challenge-result medal-${challengeResult.medal}`} aria-live="polite"><span>{challengeResult.assisted ? 'ASSISTED · UNSCORED' : challengeResult.medal === 3 ? 'GOLD' : challengeResult.medal === 2 ? 'SILVER' : challengeResult.medal === 1 ? 'BRONZE' : 'REVIEW'}</span><strong>{challengeResult.score}</strong><p>{challengeResult.summary}</p><small>{challengeResult.assisted ? 'Practice feedback only · no XP, medal record, personal best, or unlocks' : challengeResult.xp > 0 ? `+${challengeResult.xp} XP${challengeResult.newBest ? ' · PERSONAL BEST' : ''}` : 'No new reward — beat your best score'}</small><button type="button" onClick={() => startChallenge(challengeResult.challengeId)}>Run it again</button></section>}
          {challengeError && <div className="challenge-error" role="alert">{challengeError}</div>}
        </div>
        <PocketedBallTray
          ids={game.pocketedOrder}
          playback={playback}
          selectedId={placementBallId}
          onDragStart={sandbox && permissions.restoreBalls && !inMotion ? (drag) => { setPlacementBallId(drag.id); setTrayDrag(drag); } : undefined}
          onDragMove={sandbox && permissions.restoreBalls && !inMotion ? setTrayDrag : undefined}
          onDrop={sandbox && permissions.restoreBalls && !inMotion ? dropPocketedBall : undefined}
          onDragCancel={sandbox && permissions.restoreBalls && !inMotion ? cancelTrayDrag : undefined}
        />
        </div>
      </section>
    </main>
  );
}
