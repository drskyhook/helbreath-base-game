import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@tanstack/react-store';
import { playerHoverOverlayStore } from '../store/PlayerHoverOverlay.store';
import { MONSTER_OVERLAY_TRANSPARENCY } from '../../Config';
import '../rpg-ui.css';

/**
 * Floating label for a player under the cursor (local or remote): character name and optional spawn protection.
 */
export function PlayerHoverOverview() {
    const playerInfo = useStore(playerHoverOverlayStore, (state) => state.playerInfo);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | undefined>(undefined);

    useEffect(() => {
        const updatePortalTarget = () => {
            const fullscreenElement = document.fullscreenElement;
            if (fullscreenElement instanceof HTMLElement) {
                setPortalTarget(fullscreenElement);
            } else {
                setPortalTarget(document.body);
            }
        };

        updatePortalTarget();
        document.addEventListener('fullscreenchange', updatePortalTarget);
        return () => document.removeEventListener('fullscreenchange', updatePortalTarget);
    }, []);

    if (!playerInfo || !portalTarget) {
        return null;
    }

    const dialog = (
        <div
            style={{
                position: 'fixed',
                left: `${playerInfo.overlayScreenX}px`,
                top: `${playerInfo.overlayScreenY}px`,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 20002,
                width: 'fit-content',
                minWidth: '120px',
                opacity: MONSTER_OVERLAY_TRANSPARENCY,
            }}
        >
            <div
                style={{
                    background: 'linear-gradient(135deg, rgba(26, 15, 10, 0.98) 0%, rgba(45, 24, 16, 0.98) 100%)',
                    border: '2px solid var(--rpg-leather)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(212, 175, 55, 0.15)',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: '4px',
                }}
            >
                <span
                    style={{
                        color: 'var(--rpg-parchment)',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        fontFamily: 'Georgia, serif',
                        textShadow: '1px 1px 2px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.8)',
                        whiteSpace: 'nowrap',
                        textAlign: 'left',
                    }}
                >
                    {playerInfo.characterName}
                </span>
                {playerInfo.spawnProtection ? (
                    <span
                        style={{
                            color: '#6bff8a',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            fontFamily: 'Georgia, serif',
                            textShadow: '1px 1px 2px rgba(0, 0, 0, 0.9)',
                            textAlign: 'left',
                        }}
                    >
                        Spawn protection
                    </span>
                ) : null}
            </div>
        </div>
    );

    return createPortal(dialog, portalTarget);
}
