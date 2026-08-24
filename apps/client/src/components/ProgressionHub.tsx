import {
  COSMETIC_CATALOG,
  MASTERY_THRESHOLDS,
  PRACTICE_CHALLENGES,
  xpForLevel,
  type CosmeticLoadout,
  type AvatarSpec,
  type FriendsSnapshot,
  type GameSnapshot,
  type LeaderboardBoard,
  type LeaderboardPage,
  type LeaderboardPeriod,
  type MasteryTrack,
  type PlayerProfile
  ,type PublicProfile,
  type ReplayDocument,
  type ReplayPage
} from '@breakroom/game-core';
import { useEffect, useMemo, useState } from 'react';
import { socket } from '../socket.js';
import { AvatarFace } from './AvatarFace.js';
import { AvatarStudio } from './AvatarStudio.js';
import { ReplayViewer } from './ReplayViewer.js';

interface ProgressionHubProps {
  profile: PlayerProfile;
  onClose: () => void;
  onProfile: (profile: PlayerProfile) => void;
  inRoom?: boolean | undefined;
  onBranchReplay?: ((snapshot: GameSnapshot) => void) | undefined;
}

const TRACK_LABELS: Record<MasteryTrack, string> = {
  break: 'Break', precision: 'Precision', rails: 'Rails', control: 'Control', technique: 'Technique', runout: 'Runout'
};

const LOADOUT_LABELS: Record<keyof CosmeticLoadout, string> = {
  cue: 'Cue', tableFinish: 'Table', cloth: 'Cloth', trail: 'Trail', frame: 'Profile frame', stinger: 'Score sound',
  cueBall: 'Cue ball', ballSet: 'Object balls', soundSet: 'Collision sound'
};

export function ProgressionHub({ profile, onClose, onProfile, inRoom = false, onBranchReplay }: ProgressionHubProps) {
  const [board, setBoard] = useState<LeaderboardBoard>('overall');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all-time');
  const [page, setPage] = useState<LeaderboardPage | null>(null);
  const [tab, setTab] = useState<'progress' | 'leaderboard' | 'stats' | 'avatar' | 'friends' | 'replays' | 'store' | 'loadout'>('progress');
  const [busy, setBusy] = useState(false);
  const [friends, setFriends] = useState<FriendsSnapshot | null>(null);
  const [friendName, setFriendName] = useState('');
  const [friendSearch, setFriendSearch] = useState<PublicProfile | null>(null);
  const [viewedProfile, setViewedProfile] = useState<PublicProfile | null>(null);
  const [friendError, setFriendError] = useState('');
  const [replayPage, setReplayPage] = useState<ReplayPage | null>(null);
  const [activeReplay, setActiveReplay] = useState<ReplayDocument | null>(null);
  const [replayMode, setReplayMode] = useState<'eight-ball' | 'nine-ball'>('eight-ball');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [storeMessage, setStoreMessage] = useState('');
  const levelStart = xpForLevel(profile.level);
  const levelEnd = xpForLevel(profile.level + 1);
  const levelProgress = (profile.totalXp - levelStart) / Math.max(1, levelEnd - levelStart);
  const owned = useMemo(() => new Set(profile.unlocks), [profile.unlocks]);

  useEffect(() => {
    if (tab !== 'leaderboard') return;
    setPage(null);
    socket.emit('leaderboard:list', { board, period }, (result) => { if (result.ok) setPage(result.data); });
  }, [board, period, tab]);

  useEffect(() => {
    if (tab !== 'friends') return;
    socket.emit('friends:list', {}, (result) => { if (result.ok) setFriends(result.data); });
  }, [tab]);

  useEffect(() => {
    if (tab !== 'replays') return;
    setReplayPage(null); setActiveReplay(null);
    socket.emit('replays:list', { mode: replayMode, period }, (result) => { if (result.ok) setReplayPage(result.data); });
  }, [period, replayMode, tab]);

  useEffect(() => {
    const update = (snapshot: FriendsSnapshot) => setFriends(snapshot);
    socket.on('friends:snapshot', update);
    return () => { socket.off('friends:snapshot', update); };
  }, []);

  const equip = <K extends keyof CosmeticLoadout>(key: K, value: CosmeticLoadout[K]) => {
    setBusy(true);
    socket.emit('profile:equip', { loadout: { ...profile.loadout, [key]: value } }, (result) => {
      setBusy(false);
      if (result.ok) onProfile(result.data);
    });
  };

  const saveAvatar = (avatar: AvatarSpec) => new Promise<void>((resolve, reject) => {
    socket.emit('profile:avatar', { avatar }, (result) => {
      if (!result.ok) { reject(new Error(result.message)); return; }
      onProfile(result.data); resolve();
    });
  });

  const purchase = (cosmeticId: string) => {
    setBusy(true); setStoreMessage('');
    socket.emit('store:purchase', { cosmeticId, idempotencyKey: crypto.randomUUID() }, (result) => {
      setBusy(false);
      if (!result.ok) { setStoreMessage(result.message); return; }
      onProfile(result.data.profile);
      setStoreMessage('Added to your collection.');
    });
  };

  const searchFriend = () => {
    setFriendError(''); setFriendSearch(null);
    socket.emit('friends:search', { name: friendName }, (result) => result.ok ? setFriendSearch(result.data) : setFriendError(result.message));
  };

  return (
    <div className="progression-backdrop" role="presentation" onPointerDown={onClose}>
      <section className="progression-hub" role="dialog" aria-modal="true" aria-label="Player progression" onPointerDown={(event) => event.stopPropagation()}>
        <header className="progression-header">
          <div className={`profile-emblem frame-${profile.loadout.frame}`}><AvatarFace avatar={profile.avatar} rank={profile.standings['eight-ball'].tier} size="large" /></div>
          <div><span>PLAYER PROFILE</span><h2>{profile.name}</h2><p>Level {profile.level} · {profile.standings['eight-ball'].tier} 8-ball · {profile.standings['nine-ball'].tier} 9-ball</p></div>
          <button type="button" aria-label="Close progression" onClick={onClose}>×</button>
        </header>
        <nav className="progression-tabs" aria-label="Progression sections">
          {(['progress', 'stats', 'avatar', 'friends', 'leaderboard', 'replays', 'store', 'loadout'] as const).map((value) => <button type="button" className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{value}</button>)}
        </nav>
        {viewedProfile && <section className="public-profile-card"><header><AvatarFace avatar={viewedProfile.avatar} rank={viewedProfile.standings['eight-ball'].tier} size="large" /><div><span>PUBLIC PLAYER CARD</span><h3>{viewedProfile.name}</h3><small>Level {viewedProfile.level}</small></div><button type="button" onClick={() => setViewedProfile(null)}>×</button></header><div className="public-ratings"><article><span>8-BALL</span><strong>{viewedProfile.standings['eight-ball'].rating}</strong><small>{viewedProfile.standings['eight-ball'].tier} · RD {Math.round(viewedProfile.standings['eight-ball'].ratingDeviation)}</small></article><article><span>9-BALL</span><strong>{viewedProfile.standings['nine-ball'].rating}</strong><small>{viewedProfile.standings['nine-ball'].tier} · RD {Math.round(viewedProfile.standings['nine-ball'].ratingDeviation)}</small></article></div><div className="public-stat-line"><span>{viewedProfile.stats.total.gamesPlayed} games</span><span>{viewedProfile.stats.total.wins} wins</span><span>{viewedProfile.stats.total.scratches} scratches</span><span>{viewedProfile.stats.total.breakAndRuns} break & runs</span><span>{viewedProfile.stats.total.jumps} jumps</span><span>{viewedProfile.stats.total.masses} massés</span></div><div className="all-playstyles"><span>PLAYSTYLE</span><div>{viewedProfile.playstyle.tags.map((tag) => <i key={tag.id} title={tag.evidence}>{tag.label}</i>)}</div></div></section>}

        {tab === 'progress' && <div className="progression-content progress-overview">
          <section className="level-card">
            <div><span>LEVEL {profile.level}</span><strong>{profile.totalXp.toLocaleString()} XP</strong></div>
            <div className="xp-track"><i style={{ width: `${Math.max(0, Math.min(1, levelProgress)) * 100}%` }} /></div>
            <small>{(levelEnd - profile.totalXp).toLocaleString()} XP to level {profile.level + 1}</small>
          </section>
          <div className="standing-grid">
            {(['eight-ball', 'nine-ball'] as const).map((mode) => { const standing = profile.standings[mode]; return <article key={mode}><span>{mode === 'eight-ball' ? '8-BALL' : '9-BALL'}</span><strong>{standing.tier}</strong><b>{standing.rating}</b><small>{standing.wins}W · {standing.losses}L · {standing.ratedRacks} rated</small></article>; })}
          </div>
          <section className="mastery-grid">
            {(Object.keys(TRACK_LABELS) as MasteryTrack[]).map((track) => {
              const progress = profile.mastery[track]; const thresholds = MASTERY_THRESHOLDS[track];
              const next = thresholds.find((target) => progress < target) ?? thresholds[2];
              const rank = progress >= thresholds[2] ? 3 : progress >= thresholds[1] ? 2 : progress >= thresholds[0] ? 1 : 0;
              return <article key={track}><div><span>{TRACK_LABELS[track]}</span><b>{rank}/3</b></div><strong>{progress}</strong><div className="mastery-track"><i style={{ width: `${Math.min(100, progress / next * 100)}%` }} /></div><small>{rank === 3 ? 'Mastered' : `${next - progress} to next tier`}</small></article>;
            })}
          </section>
          <section className="challenge-progress-grid">
            <header><span>PRACTICE CHALLENGES</span><small>Personal-best rewards</small></header>
            {PRACTICE_CHALLENGES.map((challenge) => {
              const progress = profile.challenges.find((entry) => entry.challengeId === challenge.id);
              return <article key={challenge.id}><div className={`challenge-medal medal-${progress?.medal ?? 0}`}>{progress?.medal === 3 ? 'G' : progress?.medal === 2 ? 'S' : progress?.medal === 1 ? 'B' : '—'}</div><strong>{challenge.name}</strong><span>{progress?.bestScore ?? 0}</span><small>BEST</small></article>;
            })}
          </section>
          <section className="recovery-card"><span>PROFILE RECOVERY</span><p>A recovery key adds this profile to another device. Creating a new one invalidates the old key.</p><button type="button" onClick={() => socket.emit('profile:recovery-create', {}, (result) => { if (result.ok) setRecoveryKey(result.data.recoveryKey); })}>Create recovery key</button>{recoveryKey && <code>{recoveryKey}</code>}</section>
        </div>}

        {tab === 'stats' && <div className="progression-content stats-view">
          <section className="playstyle-card"><span>INFERRED PLAYSTYLE</span><div>{profile.playstyle.primary.length ? profile.playstyle.primary.map((tag) => <article key={tag.id}><strong>{tag.label}</strong><small>{Math.round(tag.confidence * 100)}% confidence · {tag.evidence}</small></article>) : <p>Play at least 20 verified shots to establish a style.</p>}</div></section>
          <section className="style-axes" aria-label="Playstyle tendencies">{profile.playstyle.axes.map((axis) => <article key={axis.id}><header><span>{axis.lowLabel}</span><strong>{axis.id.replaceAll('-', ' ')}</strong><span>{axis.highLabel}</span></header><div><i style={{ left: `${Math.max(0, Math.min(1, (axis.value + 1) / 2)) * 100}%` }} /></div><small>{axis.trend === 'rising' ? `Trending ${axis.highLabel}` : axis.trend === 'falling' ? `Trending ${axis.lowLabel}` : 'Established tendency'} · {Math.round(axis.confidence * 100)}% confidence</small></article>)}</section>
          <section className="stats-grid">{([
            ['Record', `${profile.stats.total.wins}–${profile.stats.total.losses}`], ['Games', profile.stats.total.gamesPlayed], ['Strokes', profile.stats.total.strokes],
            ['Play time', `${Math.floor(profile.stats.total.playtimeMs / 3_600_000)}h ${Math.floor(profile.stats.total.playtimeMs / 60_000) % 60}m`],
            ['Pocketed', profile.stats.total.ballsPocketed], ['Scratches', profile.stats.total.scratches], ['Fouls', profile.stats.total.fouls],
            ['Break & runs', profile.stats.total.breakAndRuns], ['Wins on break', profile.stats.total.winsAsBreaker], ['8 foul losses', profile.stats.total.eightBallFoulLosses],
            ['Jumps', profile.stats.total.jumps], ['Massés', profile.stats.total.masses], ['Banks', profile.stats.total.banks], ['Kicks', profile.stats.total.kicks],
            ['Multi-rail', profile.stats.total.multiRailShots], ['Called makes', `${profile.stats.total.calledMakes}/${profile.stats.total.calledShots}`], ['Longest run', profile.stats.total.longestRun]
          ] as Array<[string, string | number]>).map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
          <section className="all-playstyles"><span>PUBLIC STYLE TAGS</span><div>{profile.playstyle.tags.map((tag) => <i title={tag.evidence} key={tag.id}>{tag.label}</i>)}</div></section>
        </div>}

        {tab === 'avatar' && <div className="progression-content"><AvatarStudio profile={profile} onSave={saveAvatar} /></div>}

        {tab === 'friends' && <div className="progression-content friends-view">
          <div className="friend-search"><input value={friendName} placeholder="Exact player name" onChange={(event) => setFriendName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') searchFriend(); }} /><button type="button" onClick={searchFriend}>Find</button></div>
          {friendError && <p className="friend-error">{friendError}</p>}
          {friendSearch && friendSearch.id !== profile.id && <article className="friend-search-result"><AvatarFace avatar={friendSearch.avatar} rank={friendSearch.standings['eight-ball'].tier} size="small" /><strong>{friendSearch.name}<small>LV {friendSearch.level}</small></strong><button type="button" onClick={() => setViewedProfile(friendSearch)}>View</button><button type="button" onClick={() => socket.emit('friends:request', { profileId: friendSearch.id }, (result) => { if (result.ok) { setFriends(result.data); setFriendSearch(null); } })}>Add friend</button></article>}
          <section className="friend-requests"><span>REQUESTS</span>{friends?.requests.length ? friends.requests.map((request) => <article key={`${request.direction}-${request.profile.id}`}><AvatarFace avatar={request.profile.avatar} size="small" /><strong>{request.profile.name}<small>{request.direction}</small></strong>{request.direction === 'incoming' && <><button type="button" onClick={() => socket.emit('friends:respond', { profileId: request.profile.id, accept: true }, (result) => { if (result.ok) setFriends(result.data); })}>Accept</button><button type="button" onClick={() => socket.emit('friends:respond', { profileId: request.profile.id, accept: false }, (result) => { if (result.ok) setFriends(result.data); })}>Decline</button></>}</article>) : <p>No pending requests.</p>}</section>
          <section className="friends-list"><span>FRIENDS</span>{friends?.friends.length ? friends.friends.map((friend) => <article key={friend.id}><AvatarFace avatar={friend.avatar} rank={friend.standings['eight-ball'].tier} size="small" /><strong>{friend.name}<small>{friend.presence.replace('-', ' ')}</small></strong><button type="button" onClick={() => setViewedProfile(friend)}>View</button>{inRoom && <button type="button" onClick={() => socket.emit('friends:invite', { profileId: friend.id }, () => undefined)}>Invite</button>}<button type="button" onClick={() => socket.emit('friends:remove', { profileId: friend.id }, (result) => { if (result.ok) setFriends(result.data); })}>Remove</button><button type="button" onClick={() => socket.emit('friends:block', { profileId: friend.id, blocked: true }, (result) => { if (result.ok) setFriends(result.data); })}>Block</button></article>) : <p>No friends yet.</p>}</section>
        </div>}

        {tab === 'replays' && <div className="progression-content replay-board-view">
          {activeReplay ? <ReplayViewer replay={activeReplay} onBack={() => setActiveReplay(null)} onBranch={(snapshot) => onBranchReplay?.(snapshot)} /> : <>
            <div className="leaderboard-filters"><div>{(['eight-ball', 'nine-ball'] as const).map((value) => <button type="button" className={replayMode === value ? 'active' : ''} onClick={() => setReplayMode(value)} key={value}>{value === 'eight-ball' ? '8-Ball' : '9-Ball'}</button>)}</div><div>{(['all-time', 'thirty-days'] as const).map((value) => <button type="button" className={period === value ? 'active' : ''} onClick={() => setPeriod(value)} key={value}>{value === 'all-time' ? 'All time' : '30 days'}</button>)}</div></div>
            <div className="replay-list">{replayPage?.entries.map((entry, index) => <button type="button" key={entry.id} onClick={() => socket.emit('replay:get', { replayId: entry.id }, (result) => { if (result.ok) setActiveReplay(result.data); })}><b>#{index + 1}</b><span>{entry.participants[0].name} vs {entry.participants[1].name}<small>{new Date(entry.endedAt).toLocaleDateString()} · {entry.shotCount} shots · {entry.ruleset.toUpperCase()}</small></span><strong>{entry.qualityScore.toLocaleString()}</strong></button>)}</div>
          </>}
        </div>}

        {tab === 'leaderboard' && <div className="progression-content leaderboard-view">
          <div className="leaderboard-filters">
            <div>{(['overall', 'eight-ball', 'nine-ball'] as LeaderboardBoard[]).map((value) => <button type="button" className={board === value ? 'active' : ''} key={value} onClick={() => setBoard(value)}>{value === 'overall' ? 'Overall' : value === 'eight-ball' ? '8-Ball' : '9-Ball'}</button>)}</div>
            <div>{(['all-time', 'thirty-days'] as LeaderboardPeriod[]).map((value) => <button type="button" className={period === value ? 'active' : ''} key={value} onClick={() => setPeriod(value)}>{value === 'all-time' ? 'All time' : '30 days'}</button>)}</div>
          </div>
          {!page && <p className="leaderboard-loading">Loading standings…</p>}
          {page && <div className="leaderboard-table" role="table" aria-label="Leaderboard">
            {page.entries.length === 0 && <p>No established players in this board yet.</p>}
            {page.entries.map((entry) => <div className={entry.isSelf ? 'self' : ''} role="row" key={entry.profileId}><b>{entry.rank}</b><span className={`mini-frame frame-${entry.frame}`}><AvatarFace avatar={entry.avatar} rank={entry.tier ?? undefined} size="small" /></span><strong><button type="button" onClick={() => socket.emit('profile:public', { profileId: entry.profileId }, (result) => { if (result.ok) setViewedProfile(result.data); })}>{entry.name}</button><small>LV {entry.level}{entry.tier ? ` · ${entry.tier}${entry.ratingDeviation ? ` ±${Math.round(entry.ratingDeviation)}` : ''}` : ''}</small></strong><em>{entry.value.toLocaleString()}<small>{board === 'overall' ? 'XP' : 'RATING'}</small></em></div>)}
          </div>}
          {page?.aroundMe.length ? <section className="around-me"><span>AROUND YOU</span>{page.aroundMe.map((entry) => <div key={entry.profileId} className={entry.isSelf ? 'self' : ''}><b>#{entry.rank}</b><strong>{entry.name}</strong><em>{entry.value.toLocaleString()}</em></div>)}</section> : null}
        </div>}

        {tab === 'store' && <div className="progression-content store-view">
          <header className="store-balance"><div><span>AVAILABLE BALANCE</span><strong>{profile.availableXp.toLocaleString()} XP</strong></div><small>{profile.totalXp.toLocaleString()} lifetime · {profile.xpSpent.toLocaleString()} spent · Level {profile.level}</small></header>
          <p>Level establishes access. Available XP purchases cosmetics without reducing your level or lifetime record.</p>
          {storeMessage && <div className="store-message" role="status">{storeMessage}</div>}
          <div className="store-grid">{COSMETIC_CATALOG.filter((item) => item.priceXp !== undefined && !item.mastery).map((item) => {
            const isOwned = owned.has(item.id); const levelLocked = profile.level < (item.level ?? 1); const balanceLocked = profile.availableXp < (item.priceXp ?? 0);
            return <article className={isOwned ? 'owned' : levelLocked ? 'level-locked' : ''} key={item.id}><div className={`store-swatch store-${item.category}`}><i /></div><span>{item.category === 'avatarAccent' ? 'Avatar' : LOADOUT_LABELS[item.category]}</span><strong>{item.name}</strong><small>{levelLocked ? `Reach level ${item.level}` : `${item.priceXp?.toLocaleString()} XP`}</small><button type="button" disabled={busy || isOwned || levelLocked || balanceLocked} title={balanceLocked && !levelLocked ? 'Not enough available XP' : undefined} onClick={() => purchase(item.id)}>{isOwned ? 'Owned' : levelLocked ? `LV ${item.level}` : balanceLocked ? 'Need XP' : 'Unlock'}</button></article>;
          })}</div>
          <section className="mastery-store-note"><strong>Mastery rewards stay earned.</strong><span>Achievement cosmetics cannot be purchased; complete their listed mastery tracks.</span></section>
        </div>}

        {tab === 'loadout' && <div className="progression-content loadout-view">
          <p>Unlocked cosmetics are visual and acoustic only. Table finishes and cloth designs never change physics.</p>
          <div className="loadout-grid">{(Object.keys(LOADOUT_LABELS) as Array<keyof CosmeticLoadout>).map((key) => {
            const options = COSMETIC_CATALOG.filter((item) => item.category === key && owned.has(item.id));
            return <label key={key}><span>{LOADOUT_LABELS[key]}</span><select value={profile.loadout[key]} disabled={busy} onChange={(event) => equip(key, event.target.value as CosmeticLoadout[typeof key])}>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
          })}</div>
          <section className="unlock-shelf"><span>UNLOCKED · {profile.unlocks.length}</span><div>{COSMETIC_CATALOG.filter((item) => owned.has(item.id)).map((item) => <i key={item.id} title={item.name}>{item.name}</i>)}</div></section>
        </div>}
      </section>
    </div>
  );
}
