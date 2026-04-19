import { useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import type { IRefPhaserGame } from '../../PhaserGame';
import { toggleMapDialog } from '../store/MapDialog.store';
import { toggleServerDialog } from '../store/ServerDialog.store';
import { togglePerformanceDialog } from '../store/PerformanceDialog.store';
import { toggleChatDialog } from '../store/ChatDialog.store';
import { toggleCameraDialog } from '../store/CameraDialog.store';
import { toggleMinimapDialog, minimapDialogStore } from '../store/MinimapDialog.store';
import { toggleSoundDialog } from '../store/SoundDialog.store';
import { toggleMonsterDialog } from '../store/MonsterDialog.store';
import { toggleNPCDialog } from '../store/NPCDialog.store';
import { toggleEffectDialog } from '../store/EffectDialog.store';
import { toggleCastDialog } from '../store/CastDialog.store';
import { controlsDialogStore, setIsFullscreen } from '../store/ControlsDialog.store';
import { togglePlayerDialog } from '../store/PlayerDialog.store';
import { toggleInventoryDialog } from '../store/InventoryDialog.store';
import { toggleItemDialog } from '../store/ItemDialog.store';
import { serverDialogStore } from '../store/ServerDialog.store';
import { getNetworkManager } from '../../utils/RegistryUtils';
interface ControlsDialogProps {
    position: { x: number; y: number };
    phaserRef: React.RefObject<IRefPhaserGame | null>;
    zIndex?: number;
    onBringToFront?: () => void;
}

export function ControlsDialog({
    position,
    phaserRef,
    zIndex,
    onBringToFront,
}: ControlsDialogProps) {
    const isFullscreen = useStore(controlsDialogStore, (state) => state.isFullscreen);
    const minimapAvailable = useStore(minimapDialogStore, (state) => state.minimapAvailable);
    const logoutSecondsRemaining = useStore(controlsDialogStore, (state) => state.logoutSecondsRemaining);
    const syncWithServer = useStore(serverDialogStore, (state) => state.syncWithServer);
    const fullscreenResizeHandler = useRef<(() => void) | undefined>(undefined);
    const fullscreenHandlersBound = useRef(false);
    const fullscreenRefreshFrame = useRef<number | undefined>(undefined);

    const toggleFullscreen = () => {
        const game = phaserRef.current?.game;

        if (!game) {
            return;
        }

        const wrapper = document.getElementById('game-wrapper');
        const container = document.getElementById('game-container');
        const canvas = game.canvas;
        const baseWidth = Number(game.config.width);
        const baseHeight = Number(game.config.height);
        const scheduleScaleRefresh = () => {
            if (fullscreenRefreshFrame.current !== undefined) {
                window.cancelAnimationFrame(fullscreenRefreshFrame.current);
            }

            // Phaser refreshes its cached canvas bounds before our fullscreen CSS transform
            // is applied, so we resync after layout updates to keep pointer math aligned.
            fullscreenRefreshFrame.current = window.requestAnimationFrame(() => {
                fullscreenRefreshFrame.current = undefined;
                game.scale.refresh();
            });
        };

        const applyFullscreenScale = () => {
            const fullscreenWidth = wrapper?.clientWidth ?? window.innerWidth;
            const fullscreenHeight = wrapper?.clientHeight ?? window.innerHeight;
            const scale = Math.min(fullscreenWidth / baseWidth, fullscreenHeight / baseHeight);
            canvas.style.width = `${baseWidth}px`;
            canvas.style.height = `${baseHeight}px`;
            canvas.style.position = 'absolute';
            canvas.style.left = '50%';
            canvas.style.top = '50%';
            canvas.style.margin = '0';
            canvas.style.transformOrigin = 'center center';
            canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
            scheduleScaleRefresh();
        };

        const clearFullscreenScale = () => {
            wrapper?.classList.remove('fullscreen');
            container?.classList.remove('fullscreen');
            canvas.classList.remove('fullscreen');
            canvas.style.removeProperty('width');
            canvas.style.removeProperty('height');
            canvas.style.removeProperty('position');
            canvas.style.removeProperty('left');
            canvas.style.removeProperty('top');
            canvas.style.removeProperty('margin');
            canvas.style.removeProperty('transform');
            canvas.style.removeProperty('transform-origin');
            if (fullscreenRefreshFrame.current !== undefined) {
                window.cancelAnimationFrame(fullscreenRefreshFrame.current);
                fullscreenRefreshFrame.current = undefined;
            }
            if (fullscreenResizeHandler.current) {
                window.removeEventListener('resize', fullscreenResizeHandler.current);
                fullscreenResizeHandler.current = undefined;
            }
            scheduleScaleRefresh();
        };

        if (!fullscreenHandlersBound.current) {
            game.scale.on('enterfullscreen', () => {
                wrapper?.classList.add('fullscreen');
                container?.classList.add('fullscreen');
                canvas.classList.add('fullscreen');
                applyFullscreenScale();
                fullscreenResizeHandler.current = applyFullscreenScale;
                window.addEventListener('resize', applyFullscreenScale);
                setIsFullscreen(true);
            });

            game.scale.on('leavefullscreen', () => {
                clearFullscreenScale();
                setIsFullscreen(false);
            });

            fullscreenHandlersBound.current = true;
        }

        if (game.scale.isFullscreen) {
            game.scale.stopFullscreen();
        } else {
            game.scale.startFullscreen();
        }
    };

    const handleLogOut = () => {
        const game = phaserRef.current?.game;
        if (!game) {
            return;
        }
        const networkManager = getNetworkManager(game);
        if (!networkManager) {
            return;
        }
        if (logoutSecondsRemaining !== undefined) {
            networkManager.cancelLogout();
        } else if (!syncWithServer) {
            networkManager.disconnect();
        } else {
            networkManager.sendLogoutRequest();
        }
    };

    return (
        <DraggableDialog title="Controls" position={position} id="main-dialog" zIndex={zIndex} onBringToFront={onBringToFront}>
            <div>
                <RpgButton onClick={toggleFullscreen}>
                    {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={togglePlayerDialog}>
                    Player
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleItemDialog}>
                    Items
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleInventoryDialog}>
                    Inventory
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleMonsterDialog}>
                    Monsters
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleNPCDialog}>
                    NPCs
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleEffectDialog}>
                    Effects
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleCastDialog}>
                    Spells
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleMapDialog}>
                    Maps
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleCameraDialog}>
                    Camera
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleMinimapDialog} disabled={!minimapAvailable}>
                    Minimap
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleSoundDialog}>
                    Sound
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleServerDialog}>
                    Server
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={togglePerformanceDialog}>
                    Performance
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={toggleChatDialog}>
                    Chat
                </RpgButton>
            </div>
            <div>
                <RpgButton onClick={handleLogOut}>
                    {logoutSecondsRemaining !== undefined
                        ? `Cancel (${logoutSecondsRemaining})`
                        : 'Log Out'}
                </RpgButton>
            </div>
        </DraggableDialog>
    );
}
