import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import { EventBus } from '../../game/EventBus';
import { IN_UI_SUPPRESS_POINTER_INPUT } from '../../constants/EventNames';
import { getNetworkManager } from '../../utils/RegistryUtils';
import type { IRefPhaserGame } from '../../PhaserGame';
import type { ChatMessageEntry } from '../store/ChatDialog.store';

interface ChatDialogProps {
    messages: ChatMessageEntry[];
    position: { x: number; y: number };
    phaserRef: RefObject<IRefPhaserGame | null>;
    onClose: () => void;
    zIndex?: number;
    onBringToFront?: () => void;
}

export function ChatDialog({
    messages,
    position,
    phaserRef,
    onClose,
    zIndex,
    onBringToFront,
}: ChatDialogProps) {
    const [draft, setDraft] = useState('');
    const messagesRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const element = messagesRef.current;
        if (!element) {
            return;
        }

        element.scrollTop = element.scrollHeight;
    }, [messages.length]);

    const formattedMessages = useMemo(() => {
        return messages.map((entry, index) => ({
            key: `${entry.timestampMs}-${index}`,
            time: new Date(entry.timestampMs).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            }),
            ...entry,
        }));
    }, [messages]);

    const suppressPointerLeak = () => {
        EventBus.emit(IN_UI_SUPPRESS_POINTER_INPUT, 150);
    };

    const sendMessage = () => {
        const message = draft.trim();
        if (!message) {
            return;
        }

        const game = phaserRef.current?.game;
        if (!game) {
            return;
        }

        const networkManager = getNetworkManager(game);
        if (!networkManager) {
            return;
        }

        networkManager.sendChatMessage(message);
        setDraft('');
        suppressPointerLeak();
    };

    return (
        <DraggableDialog
            title="Chat"
            position={position}
            id="chat-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: 420,
                    height: 320,
                    gap: 12,
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    suppressPointerLeak();
                }}
            >
                <div
                    ref={messagesRef}
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        padding: 8,
                        border: '1px solid rgba(240, 220, 180, 0.35)',
                        background: 'rgba(20, 12, 6, 0.45)',
                        color: 'var(--rpg-parchment)',
                        fontFamily: '"Trebuchet MS", sans-serif',
                        fontSize: 14,
                        lineHeight: 1.4,
                    }}
                >
                    {formattedMessages.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No messages yet.</div>
                    ) : (
                        formattedMessages.map((entry) => (
                            <div key={entry.key} style={{ marginBottom: 6, wordBreak: 'break-word' }}>
                                <span style={{ opacity: 0.7 }}>[{entry.time}] </span>
                                <span style={{ fontWeight: 700 }}>{entry.senderCharacterName}:</span>{' '}
                                <span>{entry.message}</span>
                            </div>
                        ))
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        type="text"
                        value={draft}
                        maxLength={256}
                        placeholder="Type a message..."
                        onChange={(e) => setDraft(e.target.value)}
                        onFocus={suppressPointerLeak}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            suppressPointerLeak();
                        }}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            padding: '8px 10px',
                            border: '1px solid rgba(240, 220, 180, 0.35)',
                            background: 'rgba(12, 8, 4, 0.85)',
                            color: 'var(--rpg-parchment)',
                            fontSize: 14,
                        }}
                    />
                    <RpgButton
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            sendMessage();
                        }}
                        disabled={!draft.trim()}
                        style={{ width: 90 }}
                    >
                        Send
                    </RpgButton>
                </div>
            </div>
        </DraggableDialog>
    );
}
