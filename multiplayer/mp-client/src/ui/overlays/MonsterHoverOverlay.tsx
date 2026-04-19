import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@tanstack/react-store';
import { monsterHoverOverlayStore } from '../store/MonsterHoverOverlay.store';
import { MONSTER_OVERLAY_TRANSPARENCY } from '../../Config';
import { MONSTER_ALLEGIANCE_LABELS, MonsterAllegiance } from '../../Types';
import '../rpg-ui.css';

const HEALTH_BAR_MIN_WIDTH = 100;
const NAME_PADDING = 30;
const MONSTER_ALLEGIANCE_COLORS: Record<MonsterAllegiance, string> = {
    [MonsterAllegiance.Hostile]: '#ff6b6b',
    [MonsterAllegiance.Neutral]: '#6bb3ff',
    [MonsterAllegiance.Friendly]: '#6bff8a',
};

export function MonsterHoverOverlay() {
    const monsterInfo = useStore(monsterHoverOverlayStore, (state) => state.monsterInfo);
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

    if (!monsterInfo || !portalTarget) {
        return null;
    }

    const hpPercent = Math.max(0, Math.min(1, monsterInfo.maxHp > 0 ? monsterInfo.hp / monsterInfo.maxHp : 0));

    const dialog = (
        <div
            style={{
                position: 'fixed',
                left: `${monsterInfo.overlayScreenX}px`,
                top: `${monsterInfo.overlayScreenY}px`,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 20001,
                width: 'fit-content',
                minWidth: HEALTH_BAR_MIN_WIDTH,
                opacity: MONSTER_OVERLAY_TRANSPARENCY,
            }}
        >
            <div
                style={{
                    background: 'linear-gradient(135deg, rgba(26, 15, 10, 0.98) 0%, rgba(45, 24, 16, 0.98) 100%)',
                    border: '2px solid var(--rpg-leather)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(212, 175, 55, 0.15)',
                    padding: '8px 10px',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                }}
            >
                {/* Health bar container - stretches to match dialog width */}
                <div
                    style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: 24,
                        minWidth: HEALTH_BAR_MIN_WIDTH,
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: `0 ${NAME_PADDING}px`,
                        background: 'linear-gradient(180deg, rgba(60, 20, 20, 0.95) 0%, rgba(40, 10, 10, 0.95) 100%)',
                        border: '1px solid rgba(139, 0, 0, 0.8)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.5)',
                    }}
                >
                    {/* Health fill */}
                    <div
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: `${hpPercent * 100}%`,
                            background: 'linear-gradient(180deg, #8b2020 0%, #5c1010 50%, #3d0a0a 100%)',
                            borderRadius: '3px',
                            transition: 'width 0.15s ease-out',
                            boxShadow: 'inset 0 1px 0 rgba(255, 100, 100, 0.3)',
                        }}
                    />

                    {/* Monster name - in flow so it sizes the bar */}
                    <span
                        style={{
                            position: 'relative',
                            zIndex: 1,
                            color: 'var(--rpg-parchment)',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            fontFamily: 'Georgia, serif',
                            textShadow: '1px 1px 2px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.8)',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {monsterInfo.name}
                    </span>
                </div>
                <div
                    style={{
                        marginTop: '6px',
                        textAlign: 'center',
                        color: MONSTER_ALLEGIANCE_COLORS[monsterInfo.allegiance],
                        fontSize: '12px',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 2px rgba(0, 0, 0, 0.9)',
                    }}
                >
                    {MONSTER_ALLEGIANCE_LABELS[monsterInfo.allegiance]}
                </div>

                {/* Stats section - same aesthetics as AssetDebugOverlay */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '8px 12px',
                        marginTop: '8px',
                        borderTop: '1px solid var(--rpg-leather)',
                    }}
                >
                    <div className="rpg-stat-item">
                        <span className="rpg-stat-label">Health:</span>
                        <span className="rpg-stat-value">{monsterInfo.hp}/{monsterInfo.maxHp}</span>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(dialog, portalTarget);
}
