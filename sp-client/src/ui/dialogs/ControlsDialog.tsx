import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import { EventBus } from '../../game/EventBus';
import type { IRefPhaserGame } from '../../PhaserGame';
import { IN_UI_REQUEST_PLAYER_LOGOUT } from '../../constants/EventNames';
import { resetMapDialogToDefaults, toggleMapDialog, setMapDialogOpen } from '../store/MapDialog.store';
import { toggleCameraDialog, setCameraDialogOpen } from '../store/CameraDialog.store';
import { toggleMinimapDialog, setMinimapDialogOpen, minimapDialogStore } from '../store/MinimapDialog.store';
import { toggleSoundDialog, setSoundDialogOpen } from '../store/SoundDialog.store';
import { toggleMonsterDialog, setMonsterDialogOpen } from '../store/MonsterDialog.store';
import { toggleNPCDialog, setNPCDialogOpen } from '../store/NPCDialog.store';
import { toggleEffectDialog, setEffectDialogOpen } from '../store/EffectDialog.store';
import { toggleCastDialog, setCastDialogOpen } from '../store/CastDialog.store';
import { controlsDialogStore, setControlsDialogOpen } from '../store/ControlsDialog.store';
import { togglePlayerDialog, setPlayerDialogOpen } from '../store/PlayerDialog.store';
import { toggleInventoryDialog, setInventoryDialogOpen } from '../store/InventoryDialog.store';
import { toggleItemDialog, setItemDialogOpen } from '../store/ItemDialog.store';
import { togglePhaserFullscreen } from '../../utils/RendererUtils';
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

    const toggleFullscreen = () => {
        togglePhaserFullscreen(phaserRef.current?.game);
    };

    const handleLogOut = () => {
        resetMapDialogToDefaults();
        // Close all dialogs
        setMapDialogOpen(false);
        setCameraDialogOpen(false);
        setMinimapDialogOpen(false);
        setSoundDialogOpen(false);
        setMonsterDialogOpen(false);
        setNPCDialogOpen(false);
        setEffectDialogOpen(false);
        setCastDialogOpen(false);
        setPlayerDialogOpen(false);
        setInventoryDialogOpen(false);
        setItemDialogOpen(false);
        setControlsDialogOpen(false);
        // Emit logout request to Phaser
        EventBus.emit(IN_UI_REQUEST_PLAYER_LOGOUT);
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
                <RpgButton onClick={handleLogOut}>
                    Log Out
                </RpgButton>
            </div>
            {/* {spriteFrameMap.get('sprite-mmantle04-6-0') && (
                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                    <img 
                        src={spriteFrameMap.get('sprite-mmantle04-6-0')} 
                        alt="Mmantle04 Animation 6 Frame 0"
                        style={{ 
                            imageRendering: 'pixelated',
                            maxWidth: '100%',
                            height: 'auto'
                        }}
                    />
                </div>
            )} */}
        </DraggableDialog>
    );
}
