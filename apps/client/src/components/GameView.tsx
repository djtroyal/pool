import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  callRequirement,
  type CalledShot,
  type AimPresence,
  type PlayerSession,
  type PlayerProfile,
  type RackSettlement,
  type RoomSnapshot,
  type ShotInput,
  type ShotPlayback,
  type SpinInput,
  type TrajectoryAidFlags,
  type Vec2
} from '@breakroom/game-core';
import { playProgressSound, playShotPlayback, playTurnSound } from '../audio.js';
import { describeShotTechnique } from '../shotTechnique.js';
import { effectiveTrajectoryAids, loadTrajectoryAids, loadTrajectoryDepth, saveTrajectoryAids, saveTrajectoryDepth } from '../trajectory.js';
import { PocketedBallTray } from './PocketedBallTray.js';
import { PoolTable } from './PoolTable.js';
import { SpinControl } from './SpinControl.js';
import { TrajectoryControls } from './TrajectoryControls.js';
import { StrikeControl } from './StrikeControl.js';
import { AvatarFace } from './AvatarFace.js';
import { GameChat } from './GameChat.js';

interface GameViewProps {
  room: RoomSnapshot;
  session: PlayerSession;
  playback: ShotPlayback | null;
  opponentAim: AimPresence | null;
  onShoot: (shot: ShotInput) => void;
  onPlaceCue: (point: Vec2) => void;
  onAimUpdate: (aim: AimPresence) => void;
  onNextRack: () => void;
  onReturnPushOut: () => void;
  onLeave: () => void;
  profile: PlayerProfile | null;
  settlement: RackSettlement | null;
  onProgression: () => void;
}

function formatClock(milliseconds: number): string { return `${Math.max(0, Math.ceil(milliseconds / 1000))}`; }

const SHOT_SCORE_CALLOUT_SECONDS = 2.5;

export function GameView({ room, session, playback, opponentAim, onShoot, onPlaceCue, onAimUpdate, onNextRack, onReturnPushOut, onLeave, profile, settlement, onProgression }: GameViewProps) {
  const game = room.game!;
  const myIndex = room.players.findIndex((player) => player?.id === session.playerId) as 0 | 1;
  const opponentIndex = myIndex === 0 ? 1 : 0;
  const me = room.players[myIndex]!;
  const opponent = room.players[opponentIndex]!;
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.5);
  const [elevation, setElevation] = useState(0);
  const [english, setEnglish] = useState<SpinInput>({ side: 0, vertical: 0 });
  const [calledShot, setCalledShot] = useState<CalledShot | null>(null);
  const [pushOut, setPushOut] = useState(false);
  const [trajectoryPreference, setTrajectoryPreference] = useState<TrajectoryAidFlags>(loadTrajectoryAids);
  const [trajectoryDepth, setTrajectoryDepth] = useState(loadTrajectoryDepth);
  const [ghostTrails, setGhostTrails] = useState(() => localStorage.getItem('breakroom:trails') === 'on');
  const [now, setNow] = useState(Date.now());
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('breakroom:sound') !== 'off');
  const soundedSettlementRef = useRef<string | null>(null);
  const soundedTurnRef = useRef<string | null>(null);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(timer); }, []);
  const playbackActive = Boolean(playback && now < playback.startedAt + playback.durationMs);
  const playbackVisible = Boolean(playback && now < playback.startedAt + playback.durationMs + 1_400);
  const myTurn = game.turnIndex === myIndex;
  const interactive = myTurn && game.phase === 'aiming' && !playbackActive && me.connected && opponent.connected;
  const canConfigureShot = interactive && (!game.ballInHand || game.breakShot);
  const canShoot = interactive && !game.ballInHand && power >= 0.04;
  const requiredCall = callRequirement(game);
  const callReady = requiredCall === 'none' || Boolean(calledShot && calledShot.ballId > 0 && calledShot.pocketId);
  const trajectoryAids = useMemo(
    () => effectiveTrajectoryAids(trajectoryPreference, room.settings.allowedTrajectoryAids),
    [room.settings.allowedTrajectoryAids, trajectoryPreference]
  );

  const shootAtPower = useCallback((shotPower = power) => {
    if (!canShoot || !callReady) return;
    onShoot({ revision: game.revision, angle, power: shotPower, elevation, english, calledShot, shotKind: pushOut ? 'push-out' : 'normal' });
  }, [angle, calledShot, callReady, canShoot, elevation, english, game.revision, onShoot, power, pushOut]);

  useEffect(() => { setCalledShot(null); setPushOut(false); }, [game.revision]);

  useEffect(() => {
    if (canConfigureShot) onAimUpdate({ angle, power, elevation, english });
  }, [angle, canConfigureShot, elevation, english, onAimUpdate, power]);

  useEffect(() => {
    if (!playback || !soundOn) return undefined;
    return playShotPlayback(playback, profile?.loadout.soundSet);
  }, [playback?.id, profile?.loadout.soundSet, soundOn]);

  useEffect(() => {
    if (!playback) return;
    setEnglish({ side: 0, vertical: 0 });
    setElevation(0);
  }, [playback?.id]);

  useEffect(() => {
    if (!soundOn || !interactive) return;
    const turnKey = `${room.code}:${game.revision}:${game.turnIndex}`;
    if (soundedTurnRef.current === turnKey) return;
    soundedTurnRef.current = turnKey;
    playTurnSound(profile?.loadout.soundSet);
  }, [game.revision, game.turnIndex, interactive, profile?.loadout.soundSet, room.code, soundOn]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!interactive || ['INPUT', 'SELECT', 'BUTTON'].includes((event.target as HTMLElement).tagName)) return;
      const angleStep = (event.shiftKey ? 0.1 : 1) * Math.PI / 180;
      const powerStep = 0.01;
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') setAngle((value) => value - angleStep);
      else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') setAngle((value) => value + angleStep);
      else if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') setPower((value) => Math.min(1, value + powerStep));
      else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') setPower((value) => Math.max(0.04, value - powerStep));
      else if (event.key.toLowerCase() === 'c') setEnglish({ side: 0, vertical: 0 });
      else if (event.code === 'Space') shootAtPower();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [interactive, shootAtPower]);

  const latestMessage = game.lastEvents.at(-1)?.message ?? (game.ballInHand && myTurn ? 'Place the cue ball.' : myTurn ? 'Your shot.' : `${opponent.name} is aiming.`);
  const playStatus = playbackActive ? 'Balls in motion…' : latestMessage;
  const clockMs = game.shotClockEndsAt ? game.shotClockEndsAt - now : 0;
  const playbackSeconds = playback ? (now - playback.startedAt) / 1_000 : -1;
  const scoreComponents = playback?.scoreEvent?.components.filter((entry) => playbackSeconds >= entry.atTime && playbackSeconds - entry.atTime < SHOT_SCORE_CALLOUT_SECONDS) ?? [];
  const myReward = settlement?.rewards.find((reward) => reward.profileId === profile?.id) ?? null;

  useEffect(() => {
    if (!soundOn || playbackActive || !settlement || soundedSettlementRef.current === settlement.rackId) return;
    soundedSettlementRef.current = settlement.rackId;
    const reward = settlement.rewards.find((entry) => entry.profileId === profile?.id);
    playProgressSound(reward?.unlocks.length ? 'unlock' : reward && reward.tierBefore !== reward.tierAfter ? 'rank' : 'streak', profile?.loadout.stinger);
  }, [playbackActive, profile?.id, profile?.loadout.stinger, settlement, soundOn]);

  useEffect(() => {
    document.title = myTurn && !playbackActive
      ? `● YOUR TURN — ${playStatus} | Breakroom`
      : playbackActive ? 'Shot in motion | Breakroom' : `${opponent.name}'s turn — ${playStatus} | Breakroom`;
    return () => { document.title = 'Breakroom'; };
  }, [myTurn, opponent.name, playbackActive, playStatus]);

  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="game-brand" type="button" onClick={onLeave} aria-label="Leave game"><span className="wordmark-ball">8</span><span>BREAKROOM</span></button>
        <div className="match-label"><span>{room.settings.mode === 'eight-ball' ? '8-BALL' : '9-BALL'} · ROOM {room.code}</span><strong>{myTurn ? 'YOUR TURN' : `${opponent.name.toUpperCase()}'S TURN`} · {playStatus}</strong></div>
        <div className="header-actions">
          <TrajectoryControls
            value={trajectoryPreference}
            allowed={room.settings.allowedTrajectoryAids}
            ghostTrails={ghostTrails}
            rebounds={trajectoryDepth.rebounds}
            impacts={trajectoryDepth.impacts}
            onDepthChange={(next) => { setTrajectoryDepth(next); saveTrajectoryDepth(next); }}
            onChange={(next) => { setTrajectoryPreference(next); saveTrajectoryAids(next); }}
            onGhostTrailsChange={(enabled) => { setGhostTrails(enabled); localStorage.setItem('breakroom:trails', enabled ? 'on' : 'off'); }}
          />
          <details className="table-options-dropdown"><summary>Table</summary><div><span>{room.settings.tableDesign.replaceAll('-', ' ')}</span><span>{room.settings.clothDesign.replaceAll('-', ' ')}</span><span>{room.settings.clothSpeed.replaceAll('-', ' ')} cloth</span></div></details>
          {room.settings.opponent === 'human' && <GameChat room={room} session={session} />}
          {profile && <button className="match-profile-chip" type="button" onClick={onProgression} aria-label="Open profile and leaderboards"><AvatarFace avatar={profile.avatar} rank={profile.standings[room.settings.mode].tier} size="small" /><i>LV {profile.level}</i></button>}
          <button className="icon-button" type="button" aria-label={soundOn ? 'Mute sounds' : 'Enable sounds'} onClick={() => { const next = !soundOn; setSoundOn(next); localStorage.setItem('breakroom:sound', next ? 'on' : 'off'); }}>{soundOn ? '♪' : '×'}</button>
          <button className="leave-match" type="button" onClick={onLeave}>Leave</button>
        </div>
      </header>

      <section className="scoreboard" aria-label="Rack score">
        {room.players.map((player, index) => (
          <div className={`score-player ${game.turnIndex === index ? 'active' : ''}`} key={player!.id}>
            <AvatarFace avatar={player!.avatar} rank={player!.standing.tier} active={game.turnIndex === index} size="medium" />
            <div><span>{index === myIndex ? 'YOU' : 'OPPONENT'}</span><div className="player-name-line"><strong>{player!.name}</strong>{room.settings.mode === 'eight-ball' && <i className={`ball-group-badge ${game.groups[index as 0 | 1] ?? 'open'}`}><b aria-hidden="true" />{game.groups[index as 0 | 1] === 'solids' ? 'SOLIDS' : game.groups[index as 0 | 1] === 'stripes' ? 'STRIPES' : 'OPEN TABLE'}</i>}</div></div>
            <small className={`rank-label ${player!.standing.tier}`}>{player!.standing.tier === 'unranked' ? 'PROV' : player!.standing.tier} · {player!.standing.rating}</small>
            {!player!.connected && <em>Reconnecting</em>}
          </div>
        ))}
        <div className="score-numbers"><strong>{game.scores[0]}</strong><span>—</span><strong>{game.scores[1]}</strong><small>RACKS</small></div>
        {room.progress && <div className="performance-numbers" aria-label="Performance score"><strong key={room.progress.performanceScores[0]}>{room.progress.performanceScores[0].toLocaleString()}</strong><span>PERF</span><strong key={room.progress.performanceScores[1]}>{room.progress.performanceScores[1].toLocaleString()}</strong></div>}
        {room.settings.shotClock > 0 && game.phase === 'aiming' && <div className={`shot-clock ${clockMs < 10_000 ? 'urgent' : ''}`}><span>SHOT</span><strong>{formatClock(clockMs)}</strong></div>}
      </section>

      <section className="game-layout">
        <aside className="cue-panel" aria-label="Shot controls">
          <SpinControl value={english} angle={angle} elevation={elevation} shotType={describeShotTechnique(elevation, english)} elevationLabel="Cue elevation" disabled={!canConfigureShot} elevationDisabled={!room.settings.allowElevatedShots || !canConfigureShot} onChange={setEnglish} onAngleChange={setAngle} onElevationChange={setElevation} />
          {game.pushOutAvailable && myTurn && <label className="push-out-toggle"><input type="checkbox" checked={pushOut} onChange={(event) => setPushOut(event.target.checked)} />Push out</label>}
          {game.pushOutReturnTo !== null && myTurn && <button className="return-pushout-button" type="button" onClick={onReturnPushOut}>Pass shot back</button>}
          {requiredCall !== 'none' && !pushOut && <div className={`call-readout ${callReady ? 'ready' : ''}`}><span>{requiredCall === 'eight-only' ? 'CALL THE 8' : 'CALL SHOT'}</span><strong>{calledShot ? `${calledShot.ballId} → ${calledShot.pocketId.replaceAll('-', ' ')}` : 'Select ball, then pocket'}</strong></div>}
          <StrikeControl power={power} disabled={!canShoot || !callReady} label={game.ballInHand ? 'PLACE CUE BALL' : playbackActive ? 'BALLS IN MOTION' : myTurn ? 'STRIKE' : 'OPPONENT AIMING'} onPowerChange={setPower} onStrike={shootAtPower} onReset={() => { setEnglish({ side: 0, vertical: 0 }); setElevation(0); setPower(0.5); }} />
        </aside>
        <div className="table-stack">
        <div className="table-column">
          <PoolTable
            game={game} playback={playbackVisible ? playback : null} angle={angle} power={power} elevation={elevation} english={english}
            interactive={interactive} trajectoryAids={trajectoryAids} reboundDepth={trajectoryDepth.rebounds} impactDepth={trajectoryDepth.impacts} clothSpeed={room.settings.clothSpeed} tableDesign={room.settings.tableDesign}
            clothDesign={room.settings.clothDesign} customClothColor={room.settings.customClothColor} ghostTrails={ghostTrails}
            cueStyle={(myTurn ? me : opponent).loadout.cue} cueBallStyle={(myTurn ? me : opponent).loadout.cueBall} ballSetStyle={(myTurn ? me : opponent).loadout.ballSet} trailStyle={me.loadout.trail}
            instruction={!playbackActive && !myTurn ? `${opponent.name} is aiming`
              : game.pushOutReturnTo !== null && myTurn ? 'Shoot from here, or pass the push-out back'
                : !playbackActive && requiredCall !== 'none' && !callReady ? (calledShot?.ballId ? 'Now select the intended pocket' : requiredCall === 'eight-only' ? 'Select the 8 ball and its called pocket' : 'Select the object ball, then its called pocket')
                  : !playbackActive && game.breakShot && !game.ballInHand ? 'Set the break line and strike velocity' : undefined}
            opponentAim={!myTurn ? opponentAim : null} onAngleChange={setAngle} onPowerChange={setPower}
            callSelection={myTurn && requiredCall !== 'none' && !pushOut} selectedCallBallId={calledShot?.ballId} selectedPocketId={calledShot?.pocketId}
            onCallBall={(ballId) => { if (requiredCall !== 'eight-only' || ballId === 8) setCalledShot((call) => ({ ballId, pocketId: call?.pocketId ?? '' })); }}
            onCallPocket={(pocketId) => setCalledShot((call) => ({ ballId: requiredCall === 'eight-only' ? 8 : call?.ballId ?? -1, pocketId }))}
            onPowerGestureStrike={shootAtPower} onPlaceCue={onPlaceCue}
          />
          {scoreComponents.length > 0 && <div className="shot-score-feed" aria-live="polite">{scoreComponents.slice(-3).map((entry) => <span className={entry.points < 0 ? 'penalty' : ''} key={`${playback!.scoreEvent!.id}-${entry.code}-${entry.ballId ?? ''}`}><i>{entry.label}</i><strong>{entry.points > 0 ? '+' : ''}{entry.points}</strong></span>)}</div>}
        </div>
        <PocketedBallTray ids={game.pocketedOrder} playback={playback} soundEnabled={soundOn} />
        </div>
      </section>

      {(!me.connected || !opponent.connected) && game.phase !== 'session-over' && <div className="modal-backdrop"><div className="result-modal reconnect-modal"><span className="modal-ball">↻</span><h2>Game paused</h2><p>A disconnected seat is reserved for up to two minutes.</p></div></div>}
      {game.phase === 'rack-over' && !playbackActive && <div className="modal-backdrop"><div className="result-modal rack-result-modal"><span className="modal-ball">{room.settings.mode === 'eight-ball' ? '8' : '9'}</span><h2>{room.players[game.winnerIndex!]!.name} wins the rack</h2><p>Rack score {game.scores[0]}–{game.scores[1]} · Performance {room.progress?.performanceScores[0] ?? 0}–{room.progress?.performanceScores[1] ?? 0}</p>{myReward && <section className="reward-summary"><div><span>XP</span><strong>+{myReward.xp}</strong></div><div><span>{room.settings.competition === 'ranked' ? 'RATING' : 'CASUAL'}</span><strong>{room.settings.competition === 'ranked' ? `${myReward.ratingAfter - myReward.ratingBefore >= 0 ? '+' : ''}${myReward.ratingAfter - myReward.ratingBefore}` : '½ XP'}</strong></div><div><span>LEVEL</span><strong>{myReward.levelAfter}</strong></div>{myReward.unlocks.map((unlock) => <p key={unlock.cosmeticId}><i>UNLOCKED</i>{unlock.name}<small>{unlock.source}</small></p>)}</section>}<button className="primary-button" type="button" onClick={onNextRack}>Next {room.settings.competition} rack <span>→</span></button></div></div>}
      {game.phase === 'session-over' && !playbackActive && <div className="modal-backdrop"><div className="result-modal"><span className="modal-ball">◆</span><h2>Session ended</h2><p>Final rack score: {game.scores[0]}–{game.scores[1]}.</p><button className="primary-button" type="button" onClick={onLeave}>Return home</button></div></div>}
    </main>
  );
}
