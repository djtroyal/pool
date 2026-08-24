import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatSnapshot, PlayerSession, RoomSnapshot } from '@breakroom/game-core';
import { socket } from '../socket.js';

interface GameChatProps {
  room: RoomSnapshot;
  session: PlayerSession;
}

export function GameChat({ room, session }: GameChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const me = room.players.find((player) => player?.id === session.playerId);
  const host = room.hostPlayerId === session.playerId;

  useEffect(() => { openRef.current = open; if (open) setUnread(0); }, [open]);
  useEffect(() => {
    const snapshot = (next: ChatSnapshot) => setMessages(next.messages);
    const message = (next: ChatMessage) => {
      setMessages((current) => current.some((entry) => entry.id === next.id) ? current : [...current.slice(-59), next]);
      if (!openRef.current && next.playerId !== session.playerId) setUnread((current) => current + 1);
    };
    socket.on('chat:snapshot', snapshot);
    socket.on('chat:message', message);
    return () => { socket.off('chat:snapshot', snapshot); socket.off('chat:message', message); };
  }, [session.playerId]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending || !room.settings.chatEnabled) return;
    setSending(true); setError('');
    socket.emit('chat:send', { clientMessageId: crypto.randomUUID(), text }, (result) => {
      setSending(false);
      if (!result.ok) { setError(result.message); return; }
      setDraft('');
    });
  };

  const updateSettings = (enabled: boolean, filterEnabled: boolean) => {
    socket.emit('room:chat-settings', { enabled, filterEnabled }, (result) => {
      if (!result.ok) setError(result.message);
    });
  };

  return <div className={`game-chat ${open ? 'open' : ''}`}>
    <button className="chat-toggle" type="button" aria-expanded={open} aria-controls="game-chat-panel" onClick={() => setOpen((current) => !current)}>
      <span>Chat</span>{unread > 0 && <b>{Math.min(99, unread)}</b>}
    </button>
    {open && <section id="game-chat-panel" className="chat-panel" aria-label="Ephemeral game chat">
      <header><div><strong>Game chat</strong><small>Clears when this room closes</small></div><button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>×</button></header>
      {host && <div className="chat-host-settings">
        <label><input type="checkbox" checked={room.settings.chatEnabled} onChange={(event) => updateSettings(event.target.checked, room.settings.chatFilterEnabled)} />Enabled</label>
        <label><input type="checkbox" checked={room.settings.chatFilterEnabled} disabled={!room.settings.chatEnabled} onChange={(event) => updateSettings(room.settings.chatEnabled, event.target.checked)} />Filter</label>
      </div>}
      <div className="chat-messages" ref={listRef} aria-live="polite">
        {!messages.length && <p>{room.settings.chatEnabled ? 'No messages yet.' : 'Chat is disabled by the host.'}</p>}
        {messages.map((message) => <article className={message.playerId === session.playerId ? 'mine' : ''} key={message.id}>
          <span>{message.name}{message.filtered ? ' · filtered' : ''}</span><p>{message.text}</p>
        </article>)}
      </div>
      <div className="chat-compose">
        <input aria-label="Chat message" maxLength={240} value={draft} disabled={!room.settings.chatEnabled || sending} placeholder={room.settings.chatEnabled ? `Message as ${me?.name ?? 'player'}` : 'Chat disabled'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) send(); }} />
        <button type="button" disabled={!draft.trim() || !room.settings.chatEnabled || sending} onClick={send}>Send</button>
      </div>
      {error && <p className="chat-error">{error}</p>}
    </section>}
  </div>;
}
