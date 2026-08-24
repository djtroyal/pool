import { HOST_RESTRICTABLE_TRAJECTORY_AIDS, type PlayerSession, type RoomSettings, type RoomSnapshot } from '@breakroom/game-core';
import { TRAJECTORY_AID_LABELS } from './TrajectoryControls.js';
import { AvatarFace } from './AvatarFace.js';

interface LobbyProps {
  room: RoomSnapshot;
  session: PlayerSession;
  onSettings: (settings: RoomSettings) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}

export function Lobby({ room, session, onSettings, onReady, onStart, onLeave }: LobbyProps) {
  const me = room.players.find((player) => player?.id === session.playerId) ?? null;
  const isHost = room.hostPlayerId === session.playerId;
  const bothReady = room.players.every((player) => player?.ready && player.connected);
  const ranked = room.settings.competition === 'ranked';
  const set = <K extends keyof RoomSettings>(key: K, value: RoomSettings[K]) => onSettings({ ...room.settings, [key]: value });
  const copyInvite = async () => navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`);

  return (
    <main className="lobby-shell">
      <nav className="topbar compact">
        <a className="wordmark" href="/" onClick={(event) => { event.preventDefault(); onLeave(); }}><span className="wordmark-ball">8</span><span>BREAKROOM</span></a>
        <button className="text-button danger-text" type="button" onClick={onLeave}>Leave room</button>
      </nav>

      <section className="lobby-card">
        <div className="lobby-intro"><h1>Room settings</h1><p>{room.settings.visibility === 'open' ? 'Open room' : 'Private room'} · {ranked ? 'Ranked · standard competitive settings' : 'Casual'} · Host controls lock after play begins.</p></div>
        <button className="room-code" type="button" onClick={() => void copyInvite()} aria-label={`Copy room code ${room.code}`}>
          <span>Room code</span><strong>{room.code}</strong><small>Copy invite</small>
        </button>

        <div className="players-row">
          {room.players.map((player, index) => (
            <div className={`player-seat ${player ? 'occupied' : ''}`} key={index}>
              <span className="seat-number">0{index + 1}</span>
              {player ? <AvatarFace avatar={player.avatar} rank={player.standing.tier} active={player.ready} size="medium" /> : <div className="player-orb">?</div>}
              <div><strong>{player?.name ?? 'Empty seat'}</strong><span>{player ? `${player.connected ? (player.ready ? 'Ready' : 'Not ready') : 'Reconnecting'} · LV ${player.level} · ${player.standing.tier}` : room.settings.visibility === 'open' ? 'Listed publicly' : 'Invite by code'}</span></div>
              {player?.id === room.hostPlayerId && <i className="host-badge">Host</i>}
              {player?.ready && <i className="ready-check">✓</i>}
            </div>
          ))}
        </div>

        <div className="lobby-settings expanded">
          <label><span>Game</span><select value={room.settings.mode} disabled={!isHost} onChange={(event) => set('mode', event.target.value as RoomSettings['mode'])}><option value="eight-ball">8-Ball</option><option value="nine-ball">9-Ball</option></select></label>
          <label><span>Play</span><select value={room.settings.competition} disabled={!isHost} onChange={(event) => set('competition', event.target.value as RoomSettings['competition'])}><option value="casual">Casual</option><option value="ranked">Ranked</option></select></label>
          <label><span>Visibility</span><select value={room.settings.visibility} disabled={!isHost} onChange={(event) => set('visibility', event.target.value as RoomSettings['visibility'])}><option value="private">Private</option><option value="open">Open</option></select></label>
          <label><span>Opponent</span><select value={room.settings.opponent} disabled={!isHost || ranked || room.players.filter((player) => player?.kind === 'human').length > 1} onChange={(event) => set('opponent', event.target.value as RoomSettings['opponent'])}><option value="human">Human</option><option value="cpu">CPU</option></select></label>
          {room.settings.opponent === 'cpu' && <label><span>CPU difficulty</span><select value={room.settings.cpuDifficulty} disabled={!isHost} onChange={(event) => set('cpuDifficulty', event.target.value as RoomSettings['cpuDifficulty'])}><option value="rookie">Rookie</option><option value="club">Club</option><option value="expert">Expert</option><option value="master">Master</option></select></label>}
          <label><span>Ruleset</span><select value={room.settings.ruleset} disabled={!isHost || ranked} onChange={(event) => set('ruleset', event.target.value as RoomSettings['ruleset'])}><option value="house">House rules</option><option value="wpa">WPA</option><option value="csi-bca">CSI / BCA</option></select></label>
          {room.settings.ruleset === 'house' && <label><span>Called pockets</span><select value={room.settings.houseCallMode} disabled={!isHost || ranked} onChange={(event) => set('houseCallMode', event.target.value as RoomSettings['houseCallMode'])}><option value="eight-only">Call the 8 only</option><option value="all-shots">No slop — call every shot</option></select></label>}
          <fieldset className="lobby-trajectory"><legend>Allowed trajectory aids</legend><div>{HOST_RESTRICTABLE_TRAJECTORY_AIDS.map((aid) => <label className="toggle-row" key={aid}><input type="checkbox" checked={room.settings.allowedTrajectoryAids[aid]} disabled={!isHost || ranked} onChange={(event) => set('allowedTrajectoryAids', { ...room.settings.allowedTrajectoryAids, [aid]: event.target.checked })} /><span>{TRAJECTORY_AID_LABELS[aid]}</span></label>)}</div></fieldset>
          <label><span>Shot clock</span><select value={room.settings.shotClock} disabled={!isHost || ranked} onChange={(event) => set('shotClock', Number(event.target.value) as RoomSettings['shotClock'])}><option value="0">No clock</option><option value="45">45 seconds</option><option value="60">60 seconds</option></select></label>
          <label><span>Cloth speed</span><select value={room.settings.clothSpeed} disabled={!isHost || ranked} onChange={(event) => set('clothSpeed', event.target.value as RoomSettings['clothSpeed'])}><option value="very-slow">Very slow</option><option value="slow">Slow</option><option value="standard">Standard</option><option value="fast">Fast</option><option value="very-fast">Very fast</option></select></label>
          <label><span>Elevated shots</span><select value={room.settings.allowElevatedShots ? 'on' : 'off'} disabled={!isHost || ranked} onChange={(event) => set('allowElevatedShots', event.target.value === 'on')}><option value="on">Allowed</option><option value="off">Level cue only</option></select></label>
          {room.settings.opponent === 'human' && <label><span>Game chat</span><select value={room.settings.chatEnabled ? (room.settings.chatFilterEnabled ? 'filtered' : 'open') : 'off'} disabled={!isHost} onChange={(event) => onSettings({ ...room.settings, chatEnabled: event.target.value !== 'off', chatFilterEnabled: event.target.value === 'filtered' })}><option value="filtered">On · filtered</option><option value="open">On · unfiltered</option><option value="off">Off</option></select></label>}
          <label><span>Table frame</span><select value={room.settings.tableDesign} disabled={!isHost} onChange={(event) => set('tableDesign', event.target.value as RoomSettings['tableDesign'])}><option value="classic-walnut">Classic Walnut</option><option value="light-oak">Light Oak</option><option value="tournament-black">Tournament Black</option><option value="midnight-brass">Midnight Brass</option></select></label>
          <label><span>Cloth design</span><select value={room.settings.clothDesign} disabled={!isHost} onChange={(event) => set('clothDesign', event.target.value as RoomSettings['clothDesign'])}><option value="emerald-solid">Emerald Solid</option><option value="tournament-blue">Tournament Blue</option><option value="burgundy">Burgundy</option><option value="charcoal">Charcoal</option><option value="teal-weave">Teal Weave</option><option value="navy-diamond">Navy Diamond</option><option value="custom-solid">Custom Solid</option></select></label>
          {room.settings.clothDesign === 'custom-solid' && <label><span>Custom cloth</span><input type="color" value={room.settings.customClothColor} disabled={!isHost} onChange={(event) => set('customClothColor', event.target.value)} /></label>}
        </div>

        {!isHost && <p className="host-note">Room settings are controlled by the host.</p>}
        <div className="lobby-actions">
          <button className={me?.ready ? 'secondary-button ready-active' : 'secondary-button'} type="button" onClick={() => onReady(!me?.ready)}>{me?.ready ? '✓ Ready' : 'Mark ready'}</button>
          {isHost && <button className="primary-button" type="button" disabled={!bothReady} onClick={onStart}>Start game <span>→</span></button>}
        </div>
      </section>
      <p className="lobby-footnote"><i /> Disconnected seats are held for two minutes.</p>
    </main>
  );
}
