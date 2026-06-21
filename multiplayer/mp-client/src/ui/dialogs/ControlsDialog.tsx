import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import type { IRefPhaserGame } from '../../PhaserGame';
import { togglePhaserFullscreen } from '../../utils/RendererUtils';
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
import { controlsDialogStore } from '../store/ControlsDialog.store';
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

    const toggleFullscreen = () => {
        togglePhaserFullscreen(phaserRef.current?.game);
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
