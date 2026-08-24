import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AimPresence,
  CommandResult,
  PlayerProfile,
  PlayerSession,
  ProfileSession,
  RackSettlement,
  RoomSettings,
  RoomDirectoryEntry,
  RoomSnapshot,
  RuleEvent,
  RoomInvite,
  GameSnapshot,
  ShotInput,
  ShotPlayback,
  Vec2
} from '@breakroom/game-core';
import { socket } from './socket.js';
import { GameView } from './components/GameView.js';
import { Home } from './components/Home.js';
import { Lobby } from './components/Lobby.js';
import { Practice } from './components/Practice.js';
import { ProgressionHub } from './components/ProgressionHub.js';
import { AvatarFace } from './components/AvatarFace.js';

interface Notice {
  message: string;
  tone: 'info' | 'warning' | 'success';
}

type OpponentAim = AimPresence;

function roomCodeFromPath(): string {
  return window.location.pathname.match(/^\/room\/([A-Z0-9]{6})/i)?.[1]?.toUpperCase() ?? '';
}

function loadSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem('breakroom:session');
    return raw ? JSON.parse(raw) as PlayerSession : null;
  } catch {
    return null;
  }
}

function loadProfileSession(): ProfileSession | null {
  try {
    const raw = localStorage.getItem('breakroom:profile-session');
    return raw ? JSON.parse(raw) as ProfileSession : null;
  } catch {
    return null;
  }
}

export function App() {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [session, setSession] = useState<PlayerSession | null>(() => loadSession());
  const [profileSession, setProfileSession] = useState<ProfileSession | null>(() => loadProfileSession());
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [settlement, setSettlement] = useState<RackSettlement | null>(null);
  const [playback, setPlayback] = useState<ShotPlayback | null>(null);
  const [opponentAim, setOpponentAim] = useState<OpponentAim | null>(null);
  const [directory, setDirectory] = useState<RoomDirectoryEntry[]>([]);
  const [practice, setPractice] = useState(false);
  const [progressionOpen, setProgressionOpen] = useState(false);
  const [practiceSeed, setPracticeSeed] = useState<GameSnapshot | null>(null);
  const [invite, setInvite] = useState<RoomInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const initialCode = useMemo(roomCodeFromPath, []);

  const showError = (result: Extract<CommandResult<any>, { ok: false }>) => {
    setBusy(false);
    setNotice({ message: result.message, tone: 'warning' });
  };

  const enterRoom = (nextSession: PlayerSession, nextRoom: RoomSnapshot) => {
    localStorage.setItem('breakroom:session', JSON.stringify(nextSession));
    setSession(nextSession);
    setRoom(nextRoom);
    setPractice(false);
    setBusy(false);
    window.history.pushState({}, '', `/room/${nextRoom.code}`);
  };

  useEffect(() => {
    const onSnapshot = (snapshot: RoomSnapshot) => setRoom(snapshot);
    const onDirectory = (entries: RoomDirectoryEntry[]) => setDirectory(entries);
    const onPlayback = (nextPlayback: ShotPlayback) => setPlayback(nextPlayback);
    const onProfile = (nextProfile: PlayerProfile) => setProfile(nextProfile);
    const onPassport = (nextSession: ProfileSession) => {
      localStorage.setItem('breakroom:profile-session', JSON.stringify(nextSession));
      setProfileSession(nextSession);
    };
    const onSettlement = (nextSettlement: RackSettlement) => setSettlement(nextSettlement);
    const onRule = (ruleEvent: RuleEvent) => setNotice({ message: ruleEvent.message, tone: ruleEvent.code.includes('foul') || ruleEvent.code === 'scratch' ? 'warning' : 'info' });
    const onNotice = (nextNotice: Notice) => setNotice(nextNotice);
    const onInvite = (nextInvite: RoomInvite) => setInvite(nextInvite);
    const onAim = (payload: { playerId: string } & OpponentAim) => {
      if (payload.playerId !== session?.playerId) setOpponentAim(payload);
    };
    const onDisconnect = () => setNotice({ message: 'Connection lost. Rejoining your table…', tone: 'warning' });
    const onConnect = () => {
      socket.emit('rooms:list', {}, (result) => { if (result.ok) setDirectory(result.data); });
      if (profileSession) socket.emit('profile:resume', { token: profileSession.token }, (profileResult) => {
        if (!profileResult.ok) {
          localStorage.removeItem('breakroom:profile-session');
          setProfileSession(null); setProfile(null);
          showError(profileResult);
          return;
        }
        localStorage.setItem('breakroom:profile-session', JSON.stringify(profileResult.data.session));
        setProfileSession(profileResult.data.session);
        setProfile(profileResult.data.profile);
        if (room && session) socket.emit('room:resume', { code: room.code, token: session.token }, (result) => {
          if (result.ok) enterRoom(result.data.session, result.data.room);
        });
      });
    };
    socket.on('room:snapshot', onSnapshot);
    socket.on('rooms:directory', onDirectory);
    socket.on('shot:playback', onPlayback);
    socket.on('profile:snapshot', onProfile);
    socket.on('profile:passport', onPassport);
    socket.on('rack:settlement', onSettlement);
    socket.on('rules:event', onRule);
    socket.on('connection:notice', onNotice);
    socket.on('friends:invite', onInvite);
    socket.on('presence:aim', onAim);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('room:snapshot', onSnapshot);
      socket.off('rooms:directory', onDirectory);
      socket.off('shot:playback', onPlayback);
      socket.off('profile:snapshot', onProfile);
      socket.off('profile:passport', onPassport);
      socket.off('rack:settlement', onSettlement);
      socket.off('rules:event', onRule);
      socket.off('connection:notice', onNotice);
      socket.off('friends:invite', onInvite);
      socket.off('presence:aim', onAim);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [profileSession?.token, room?.code, session?.playerId, session?.token]);

  useEffect(() => {
    socket.emit('rooms:list', {}, (result) => { if (result.ok) setDirectory(result.data); });
    if (profileSession) socket.emit('profile:resume', { token: profileSession.token }, (result) => {
      if (result.ok) {
        localStorage.setItem('breakroom:profile-session', JSON.stringify(result.data.session));
        setProfileSession(result.data.session);
        setProfile(result.data.profile);
      }
      else {
        localStorage.removeItem('breakroom:profile-session');
        setProfileSession(null); setProfile(null); showError(result);
      }
    });
  }, []);

  useEffect(() => {
    if (!initialCode || !session || !profile || session.roomCode !== initialCode || room) return;
    setBusy(true);
    socket.emit('room:resume', { code: initialCode, token: session.token }, (result) => {
      if (result.ok) enterRoom(result.data.session, result.data.room);
      else showError(result);
    });
  }, [initialCode, profile?.id, room, session]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const withProfile = (name: string, action: (activeProfile: PlayerProfile) => void) => {
    setBusy(true);
    if (!profile) {
      socket.emit('profile:create', { name }, (result) => {
        if (!result.ok) { showError(result); return; }
        localStorage.setItem('breakroom:profile-session', JSON.stringify(result.data.session));
        if (result.data.recoveryKey) localStorage.setItem('breakroom:recovery-key', result.data.recoveryKey);
        setProfileSession(result.data.session);
        setProfile(result.data.profile);
        action(result.data.profile);
      });
      return;
    }
    if (profile.name !== name) {
      socket.emit('profile:update', { name }, (result) => {
        if (!result.ok) { showError(result); return; }
        setProfile(result.data);
        action(result.data);
      });
      return;
    }
    action(profile);
  };

  const createRoom = (name: string, settings: RoomSettings) => {
    withProfile(name, (activeProfile) => socket.emit('room:create', { settings: { ...settings, tableDesign: activeProfile.loadout.tableFinish, clothDesign: activeProfile.loadout.cloth } }, (result) => {
      if (result.ok) enterRoom(result.data.session, result.data.room);
      else showError(result);
    }));
  };

  const joinRoom = (name: string, code: string) => {
    withProfile(name, () => socket.emit('room:join', { code }, (result) => {
      if (result.ok) enterRoom(result.data.session, result.data.room);
      else showError(result);
    }));
  };

  const joinOpenRoom = (name: string, listingId: string) => {
    withProfile(name, () => socket.emit('room:join-open', { listingId }, (result) => {
      if (result.ok) enterRoom(result.data.session, result.data.room);
      else showError(result);
    }));
  };

  const recoverProfile = (recoveryKey: string) => {
    setBusy(true);
    socket.emit('profile:recover', { recoveryKey }, (result) => {
      setBusy(false);
      if (!result.ok) { showError(result); return; }
      localStorage.setItem('breakroom:profile-session', JSON.stringify(result.data.session));
      localStorage.setItem('breakroom:recovery-key', result.data.recoveryKey);
      localStorage.setItem('breakroom:name', result.data.profile.name);
      setProfileSession(result.data.session); setProfile(result.data.profile);
      setNotice({ message: 'Profile recovered. A new recovery key has replaced the old one.', tone: 'success' });
    });
  };

  const leaveRoom = () => {
    socket.emit('room:leave', {}, () => undefined);
    localStorage.removeItem('breakroom:session');
    setRoom(null);
    setSession(null);
    setPlayback(null);
    setSettlement(null);
    setOpponentAim(null);
    window.history.pushState({}, '', '/');
  };

  const applyRoomResult = (result: CommandResult<RoomSnapshot>) => {
    if (result.ok) setRoom(result.data);
    else showError(result);
  };

  const sendAim = useCallback((aim: OpponentAim) => socket.volatile.emit('aim:update', aim), []);

  return (
    <>
      {practice ? (
        <Practice profile={profile} initialGame={practiceSeed} onProfile={setProfile} onClose={() => { setPractice(false); setPracticeSeed(null); window.history.pushState({}, '', '/'); }} />
      ) : room && session ? (
        room.game ? (
          <GameView
            room={room}
            session={session}
            playback={playback}
            opponentAim={opponentAim}
            onShoot={(shot: ShotInput) => socket.emit('shot:take', shot, (result) => { if (!result.ok) showError(result); })}
            onPlaceCue={(point: Vec2) => socket.emit('cue:place', point, applyRoomResult)}
            onAimUpdate={sendAim}
            onNextRack={() => socket.emit('rack:next', {}, (result) => { if (result.ok) setSettlement(null); applyRoomResult(result); })}
            onReturnPushOut={() => socket.emit('push-out:return', {}, applyRoomResult)}
            onLeave={leaveRoom}
            profile={profile}
            settlement={settlement}
            onProgression={() => setProgressionOpen(true)}
          />
        ) : (
          <Lobby
            room={room}
            session={session}
            onSettings={(settings) => socket.emit('room:settings', { settings }, applyRoomResult)}
            onReady={(ready) => socket.emit('player:ready', { ready }, applyRoomResult)}
            onStart={() => socket.emit('match:start', {}, applyRoomResult)}
            onLeave={leaveRoom}
          />
        )
      ) : (
        <Home initialCode={initialCode} busy={busy} rooms={directory} profile={profile} onProgression={() => setProgressionOpen(true)} onCreate={createRoom} onJoin={joinRoom} onJoinOpen={joinOpenRoom} onRecover={recoverProfile} onPractice={(name) => withProfile(name, () => { setBusy(false); setPractice(true); window.history.pushState({}, '', '/practice'); })} />
      )}

      {progressionOpen && profile && <ProgressionHub profile={profile} inRoom={Boolean(room)} onClose={() => setProgressionOpen(false)} onProfile={setProfile} onBranchReplay={!room ? (snapshot) => { setPracticeSeed(snapshot); setProgressionOpen(false); setPractice(true); window.history.pushState({}, '', '/practice'); } : undefined} />}
      {invite && <div className="room-invite-toast"><AvatarFace avatar={invite.from.avatar} size="small" /><span><strong>{invite.from.name}</strong> invited you to a room.</span><button type="button" onClick={() => socket.emit('room:join-invite', { inviteId: invite.id }, (result) => { if (result.ok) { setInvite(null); enterRoom(result.data.session, result.data.room); } else showError(result); })}>Join</button><button type="button" aria-label="Dismiss invite" onClick={() => setInvite(null)}>×</button></div>}
      {notice && <div className={`toast ${notice.tone}`} role="status"><i />{notice.message}</div>}
      {busy && <div className="busy-bar" aria-label="Connecting" />}
      <div className="portrait-rotate" role="note"><span className="wordmark-ball">8</span><strong>Rotate to take your shot</strong><p>The lobby works in portrait; the table plays best in landscape.</p></div>
    </>
  );
}
