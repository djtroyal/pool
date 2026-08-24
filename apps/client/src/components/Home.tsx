import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  normalizeUsername,
  type RoomDirectoryEntry,
  type PlayerProfile,
  type RoomSettings
} from '@breakroom/game-core';
import { AvatarFace } from './AvatarFace.js';

interface HomeProps {
  initialCode: string;
  busy: boolean;
  rooms: RoomDirectoryEntry[];
  onCreate: (name: string, settings: RoomSettings) => void;
  onJoin: (name: string, code: string) => void;
  onJoinOpen: (name: string, listingId: string) => void;
  onPractice: (name: string) => void;
  onRecover: (recoveryKey: string) => void;
  profile?: PlayerProfile | null | undefined;
  onProgression?: (() => void) | undefined;
}

function Segmented<T extends string | number>({
  value, options, onChange, label
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset className="setting-field">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map((option) => (
          <button type="button" key={option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function roomStatus(room: RoomDirectoryEntry): string {
  if (room.status === 'waiting') return `${room.playerCount}/2 · Waiting`;
  if (room.status === 'full') return '2/2 · Ready lobby';
  if (room.status === 'rack-over') return 'Rack complete';
  if (room.status === 'reconnecting') return 'Player reconnecting';
  return 'In progress';
}

export function Home({ initialCode, busy, rooms, onCreate, onJoin, onJoinOpen, onPractice, onRecover, profile = null, onProgression }: HomeProps) {
  const [name, setName] = useState(() => localStorage.getItem('breakroom:name') ?? '');
  const [code, setCode] = useState(initialCode);
  const [settings, setSettings] = useState<RoomSettings>({ ...DEFAULT_SETTINGS });
  const [recoveryKey, setRecoveryKey] = useState('');
  const normalizedName = useMemo(() => normalizeUsername(name), [name]);
  const canSubmit = normalizedName !== null;
  const rememberName = () => normalizedName && localStorage.setItem('breakroom:name', normalizedName);
  useEffect(() => { if (profile) setName(profile.name); }, [profile?.id, profile?.name]);

  return (
    <main className="home-shell">
      <nav className="topbar">
        <a className="wordmark" href="/" aria-label="Breakroom home"><span className="wordmark-ball">8</span><span>BREAKROOM</span></a>
        <div className="home-nav-actions">{profile ? <button className="profile-chip" type="button" onClick={onProgression}><AvatarFace avatar={profile.avatar} rank={profile.standings['eight-ball'].tier} size="small" /><i>LV {profile.level}</i><strong>{profile.name}</strong></button> : <label className="topbar-identity"><span>Player</span><input aria-label="Your name" value={name} placeholder="Username" autoComplete="nickname" aria-invalid={name.length > 0 && !canSubmit} onChange={(event) => setName(event.target.value)} /><b className={canSubmit ? 'valid' : ''}>{canSubmit ? 'READY' : '1–20'}</b></label>}<button className="text-button" type="button" disabled={!canSubmit || busy} onClick={() => { rememberName(); onPractice(normalizedName!); }}>Practice</button></div>
      </nav>

      <section className="home-grid">
        <div className="start-card" aria-labelledby="create-heading">
          <div className="plain-heading create-room-heading"><div><small>NEW MATCH</small><h1 id="create-heading">Create room</h1></div><div className="room-format-mark" aria-hidden="true"><strong>{settings.mode === 'eight-ball' ? '8' : '9'}</strong><span>{settings.competition}</span></div></div>
          <section className="room-option-section">
            <header><span>Match</span><small>FORMAT &amp; OPPONENT</small></header>
            <div className="match-options match-format-options">
              <Segmented label="Game" value={settings.mode} options={[{ value: 'eight-ball', label: '8-Ball' }, { value: 'nine-ball', label: '9-Ball' }]} onChange={(mode) => setSettings({ ...settings, mode })} />
              <Segmented label="Play" value={settings.competition} options={[{ value: 'casual', label: 'Casual' }, { value: 'ranked', label: 'Ranked' }]} onChange={(competition) => setSettings({ ...settings, competition, ...(competition === 'ranked' ? { ruleset: 'wpa', opponent: 'human', shotClock: 60, clothSpeed: 'standard', allowElevatedShots: true } : {}) })} />
              <Segmented label="Opponent" value={settings.opponent} options={[{ value: 'human', label: 'Player' }, { value: 'cpu', label: 'CPU' }]} onChange={(opponent) => setSettings({ ...settings, opponent, competition: opponent === 'cpu' ? 'casual' : settings.competition })} />
              {settings.opponent === 'cpu' && <label className="setting-select"><span>CPU level</span><select value={settings.cpuDifficulty} onChange={(event) => setSettings({ ...settings, cpuDifficulty: event.target.value as RoomSettings['cpuDifficulty'] })}><option value="rookie">Rookie</option><option value="club">Club</option><option value="expert">Expert</option><option value="master">Master</option></select></label>}
            </div>
          </section>
          <section className="room-option-section">
            <header><span>Room &amp; rules</span><small>{settings.visibility === 'open' ? 'JOINABLE FROM ROOM LIST' : 'LISTED · CODE REQUIRED'}</small></header>
            <div className="match-options room-rule-options">
              <Segmented label="Access" value={settings.visibility} options={[{ value: 'private', label: 'Private' }, { value: 'open', label: 'Open' }]} onChange={(visibility) => setSettings({ ...settings, visibility })} />
              <label className="setting-select"><span>Ruleset</span><select value={settings.competition === 'ranked' ? 'wpa' : settings.ruleset} disabled={settings.competition === 'ranked'} onChange={(event) => setSettings({ ...settings, ruleset: event.target.value as RoomSettings['ruleset'] })}><option value="house">House</option><option value="wpa">WPA</option><option value="csi-bca">CSI / BCA</option></select></label>
              {settings.ruleset === 'house' && settings.competition !== 'ranked' && <label className="setting-select called-pocket-select"><span>Called pockets</span><select value={settings.houseCallMode} onChange={(event) => setSettings({ ...settings, houseCallMode: event.target.value as RoomSettings['houseCallMode'] })}><option value="eight-only">Call the 8 only</option><option value="all-shots">No slop — call every shot</option></select></label>}
              {settings.opponent === 'human' && <label className="setting-select"><span>Game chat</span><select value={settings.chatEnabled ? (settings.chatFilterEnabled ? 'filtered' : 'open') : 'off'} onChange={(event) => setSettings({ ...settings, chatEnabled: event.target.value !== 'off', chatFilterEnabled: event.target.value === 'filtered' })}><option value="filtered">On · filtered</option><option value="open">On · unfiltered</option><option value="off">Off</option></select></label>}
            </div>
          </section>
          <button className="primary-button create-button" type="button" disabled={!canSubmit || busy} onClick={() => { rememberName(); onCreate(normalizedName!, settings); }}>
            <span>Create room <small>· {settings.visibility}</small></span><span aria-hidden="true">→</span>
          </button>

          <div className="or-divider"><span>Join by code</span></div>
          <div className="join-row">
            <input aria-label="Room code" value={code} maxLength={6} placeholder="ROOM CODE" onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button className="secondary-button" type="button" disabled={!canSubmit || code.length !== 6 || busy} onClick={() => { rememberName(); onJoin(normalizedName!, code); }}>Join room</button>
          </div>
          {!profile && <details className="recover-profile"><summary>Recover an existing player</summary><div><input aria-label="Recovery key" value={recoveryKey} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" onChange={(event) => setRecoveryKey(event.target.value.toUpperCase())} /><button className="secondary-button" type="button" disabled={recoveryKey.length < 20 || busy} onClick={() => onRecover(recoveryKey)}>Recover</button></div></details>}
        </div>

        <section className="room-browser" aria-labelledby="rooms-heading">
          <div className="plain-heading"><h2 id="rooms-heading">Active rooms</h2><span>{rooms.length}</span></div>
          <div className="room-list" aria-live="polite">
            {rooms.length === 0 && <p className="empty-rooms">No active rooms.</p>}
            {rooms.map((room) => (
              <article className="room-row" key={room.listingId}>
                <div className="room-row-main">
                  <strong>{room.hostName}</strong>
                  <span>{room.mode === 'eight-ball' ? '8-Ball' : '9-Ball'} · {room.ruleset.toUpperCase()} · {room.opponent === 'cpu' ? 'CPU' : roomStatus(room)}</span>
                  <small className={`competition-copy ${room.competition}`}>{room.competition} · LV {room.hostLevel}{room.hostTier !== 'unranked' ? ` · ${room.hostTier}` : ''}</small>
                  {room.visibility === 'open' && room.scores && <small>{room.players.join(' vs ')} · {room.scores[0]}–{room.scores[1]}</small>}
                </div>
                <span className={`visibility-badge ${room.visibility}`}>{room.visibility}</span>
                {room.visibility === 'open' && room.joinable
                  ? <button className="secondary-button compact-button" type="button" disabled={!canSubmit || busy} onClick={() => { rememberName(); onJoinOpen(normalizedName!, room.listingId); }}>Join</button>
                  : <span className="room-unavailable">{room.visibility === 'private' ? 'Code only' : 'View only'}</span>}
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
