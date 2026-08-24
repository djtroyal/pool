import { useEffect, useState } from 'react';
import { type GameSnapshot, type ReplayDocument, type ShotPlayback, type TrajectoryAidFlags } from '@breakroom/game-core';
import { PoolTable } from './PoolTable.js';
import { AvatarFace } from './AvatarFace.js';

interface ReplayViewerProps { replay: ReplayDocument; onBack: () => void; onBranch: (snapshot: GameSnapshot) => void }
const REPLAY_AIDS: TrajectoryAidFlags = { advancedCuePath: true, simpleObjectPath: false, advancedObjectPath: true, pottedPocket: true, railContinuations: true, jumpArc: true };

export function ReplayViewer({ replay, onBack, onBranch }: ReplayViewerProps) {
  const [shotIndex, setShotIndex] = useState(0);
  const [playback, setPlayback] = useState<ShotPlayback | null>(null);
  const shot = replay.shots[shotIndex] ?? null;
  const before = shotIndex === 0 ? replay.initialSnapshot : replay.shots[shotIndex - 1]!.playback.finalSnapshot;
  useEffect(() => { setPlayback(null); }, [shotIndex, replay.id]);
  const play = () => {
    if (!shot) return;
    setPlayback({ ...shot.playback, startedAt: Date.now() + 80 });
  };
  return <div className="replay-viewer">
    <header><button type="button" onClick={onBack}>← Boards</button><div><span>PUBLIC GAME REPLAY</span><strong>{replay.participants[0].name} vs {replay.participants[1].name}</strong></div><b>{replay.qualityScore.toLocaleString()}</b></header>
    <div className="replay-players">{replay.participants.map((player, index) => <div key={player.profileId} className={replay.winnerIndex === index ? 'winner' : ''}><AvatarFace avatar={player.avatar} rank={player.standing.tier} size="small" /><strong>{player.name}</strong><span>{replay.winnerIndex === index ? 'WINNER' : player.standing.rating}</span></div>)}</div>
    <PoolTable game={playback ? shot!.playback.finalSnapshot : before} playback={playback} angle={shot?.playback.shot.angle ?? 0} power={shot?.playback.shot.power ?? .5} elevation={shot?.playback.shot.elevation ?? 0} english={shot?.playback.shot.english ?? { side: 0, vertical: 0 }} interactive={false} trajectoryAids={REPLAY_AIDS} reboundDepth={2} impactDepth={3} clothSpeed={replay.settings.clothSpeed} tableDesign={replay.settings.tableDesign} clothDesign={replay.settings.clothDesign} customClothColor={replay.settings.customClothColor} ghostTrails cueStyle={replay.participants[shot?.shooterIndex ?? 0].loadout.cue} cueBallStyle={replay.participants[shot?.shooterIndex ?? 0].loadout.cueBall} ballSetStyle={replay.participants[shot?.shooterIndex ?? 0].loadout.ballSet} trailStyle={replay.participants[shot?.shooterIndex ?? 0].loadout.trail} onAngleChange={() => undefined} onPowerChange={() => undefined} onPowerGestureStrike={() => undefined} />
    <div className="replay-transport"><button type="button" disabled={shotIndex === 0} onClick={() => setShotIndex((value) => value - 1)}>Previous</button><button className="primary-button" type="button" disabled={!shot} onClick={play}>Play shot {shotIndex + 1}</button><button type="button" disabled={shotIndex >= replay.shots.length - 1} onClick={() => setShotIndex((value) => value + 1)}>Next</button><button type="button" onClick={() => onBranch(structuredClone(before))}>Branch to practice</button></div>
    <div className="replay-forensics">{replay.shots.map((entry, index) => <button type="button" className={index === shotIndex ? 'active' : ''} key={entry.playback.id} onClick={() => setShotIndex(index)}><b>{index + 1}</b><span>{replay.participants[entry.shooterIndex].name}<small>{Math.round(entry.playback.shot.power * 100)}% · {Math.round(entry.playback.shot.elevation)}° · {(entry.aimTimeMs / 1000).toFixed(1)}s aim</small></span><em>{entry.playback.scoreEvent ? `${entry.playback.scoreEvent.delta >= 0 ? '+' : ''}${entry.playback.scoreEvent.delta}` : '—'}</em></button>)}</div>
  </div>;
}
