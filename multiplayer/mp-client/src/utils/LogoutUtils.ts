import type { Game } from 'phaser';
import { EventBus } from '../game/EventBus';
import { IN_UI_REQUEST_PLAYER_LOGOUT } from '../constants/EventNames';
import { INITIAL_GAME_WORLD_STATE_KEY } from '../constants/RegistryKeys';
import { setNetworkManager } from './RegistryUtils';
import { setSelectedMap } from '../ui/store/ControlsDialog.store';
import { resetMapDialogToDefaults, setMapDialogOpen } from '../ui/store/MapDialog.store';
import { setCameraDialogOpen } from '../ui/store/CameraDialog.store';
import { setMinimapDialogOpen } from '../ui/store/MinimapDialog.store';
import { setSoundDialogOpen } from '../ui/store/SoundDialog.store';
import { setMonsterDialogOpen } from '../ui/store/MonsterDialog.store';
import { setNPCDialogOpen } from '../ui/store/NPCDialog.store';
import { setEffectDialogOpen } from '../ui/store/EffectDialog.store';
import { setCastDialogOpen } from '../ui/store/CastDialog.store';
import { setControlsDialogOpen } from '../ui/store/ControlsDialog.store';
import { setPlayerDialogOpen } from '../ui/store/PlayerDialog.store';
import { setInventoryDialogOpen } from '../ui/store/InventoryDialog.store';
import { setItemDialogOpen } from '../ui/store/ItemDialog.store';
import { setServerDialogOpen } from '../ui/store/ServerDialog.store';
import { setPerformanceDialogOpen } from '../ui/store/PerformanceDialog.store';

/**
 * Performs logout cleanup: clears network manager, resets dialogs, closes all dialogs,
 * and emits IN_UI_REQUEST_PLAYER_LOGOUT for Phaser to handle (stop music, save state, navigate to LoginScreen).
 * Used by both the Log out button and the socket disconnected handler.
 */
export function performLogoutCleanup(game?: Game): void {
    if (game) {
        setNetworkManager(game, undefined);
        game.registry.remove(INITIAL_GAME_WORLD_STATE_KEY);
    }

    setSelectedMap('', false);
    resetMapDialogToDefaults();
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
    setServerDialogOpen(false);
    setPerformanceDialogOpen(false);
    EventBus.emit(IN_UI_REQUEST_PLAYER_LOGOUT);
}
