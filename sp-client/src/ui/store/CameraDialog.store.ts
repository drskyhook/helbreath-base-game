import { Store } from '@tanstack/react-store';
import { EventBus } from '../../game/EventBus';
import { 
    OUT_UI_SET_CAMERA_ZOOM, 
    IN_UI_CHANGE_CAMERA_ZOOM,
    OUT_UI_GAME_STATS_UPDATE,
    OUT_UI_MOUSE_POSITION_UPDATE,
    OUT_UI_CAMERA_FOLLOW_PLAYER_CHANGED,
    IN_UI_CHANGE_CAMERA_FOLLOW_PLAYER,
    IN_UI_CHANGE_CAMERA_SHAKE,
    IN_UI_CHANGE_POST_PROCESSING
} from '../../constants/EventNames';

export type PostProcessingMode = 'none' | 'fxaa';

export const MIN_GAME_WINDOW_SIZE_PERCENT = 100;
export const MAX_GAME_WINDOW_SIZE_PERCENT = 200;
export const DEFAULT_GAME_WINDOW_SIZE_PERCENT = 100;

const GAME_WINDOW_SIZE_STORAGE_KEY = 'sp-client-game-window-size-percent';

function clampGameWindowSizePercent(percent: number): number {
    return Math.min(MAX_GAME_WINDOW_SIZE_PERCENT, Math.max(MIN_GAME_WINDOW_SIZE_PERCENT, Math.round(percent)));
}

function loadGameWindowSizePercent(): number {
    try {
        const stored = localStorage.getItem(GAME_WINDOW_SIZE_STORAGE_KEY);
        if (stored !== null) {
            const parsed = Number.parseInt(stored, 10);
            if (Number.isFinite(parsed)) {
                return clampGameWindowSizePercent(parsed);
            }
        }
    } catch (error) {
        console.warn('[CameraDialog.store] Failed to load game window size:', error);
    }
    return DEFAULT_GAME_WINDOW_SIZE_PERCENT;
}

export interface PlayerPosition {
    sceneX: number | undefined; 
    sceneY: number | undefined; 
    worldX: number | undefined; 
    worldY: number | undefined;
}

interface CameraDialogState {
    isOpen: boolean;
    cameraZoom: number;
    fps: number;
    cameraPosition: { x: number; y: number };
    playerPosition: PlayerPosition;
    cursorPosition: { sceneX: number; sceneY: number; worldX: number; worldY: number } | undefined;
    followPlayer: boolean;
    cameraShake: boolean;
    postProcessing: PostProcessingMode;
    gameWindowSizePercent: number;
}

const initialState: CameraDialogState = {
    isOpen: false,
    cameraZoom: 100, // Default to 100% (zoom 1.0)
    fps: 0,
    cameraPosition: { x: 0, y: 0 },
    playerPosition: { 
        sceneX: undefined, 
        sceneY: undefined, 
        worldX: undefined, 
        worldY: undefined 
    },
    cursorPosition: undefined,
    followPlayer: true,
    cameraShake: true,
    postProcessing: 'none',
    gameWindowSizePercent: loadGameWindowSizePercent(),
};

export const cameraDialogStore = new Store<CameraDialogState>(initialState);

export const toggleCameraDialog = () => {
    cameraDialogStore.setState((state) => ({ ...state, isOpen: !state.isOpen }));
};

export const setCameraDialogOpen = (value: boolean) => {
    cameraDialogStore.setState((state) => ({ ...state, isOpen: value }));
};

export const setCameraZoom = (zoom: number, notifyPhaser = true) => {
    cameraDialogStore.setState((state) => ({ ...state, cameraZoom: zoom }));
    if (notifyPhaser) {
        // Emit event to Phaser - Phaser handles updating GameStateManager
        // Note: zoom is in percentage (20-200), Phaser expects zoom / 100
        EventBus.emit(IN_UI_CHANGE_CAMERA_ZOOM, zoom / 100);
    }
};

export const setFollowPlayer = (enabled: boolean, notifyPhaser = true) => {
    cameraDialogStore.setState((state) => ({ ...state, followPlayer: enabled }));
    if (notifyPhaser) {
        // Emit event to Phaser - Phaser handles updating camera follow state
        EventBus.emit(IN_UI_CHANGE_CAMERA_FOLLOW_PLAYER, enabled);
    }
};

export const setCameraShake = (enabled: boolean, notifyPhaser = true) => {
    cameraDialogStore.setState((state) => ({ ...state, cameraShake: enabled }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_CAMERA_SHAKE, enabled);
    }
};

export const setPostProcessing = (mode: PostProcessingMode, notifyPhaser = true) => {
    cameraDialogStore.setState((state) => ({ ...state, postProcessing: mode }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_POST_PROCESSING, mode);
    }
};

export const getGameWindowSizePercent = (): number => {
    return cameraDialogStore.state.gameWindowSizePercent;
};

export const setGameWindowSizePercent = (percent: number): number => {
    const clamped = clampGameWindowSizePercent(percent);
    cameraDialogStore.setState((state) => ({ ...state, gameWindowSizePercent: clamped }));
    try {
        localStorage.setItem(GAME_WINDOW_SIZE_STORAGE_KEY, String(clamped));
    } catch (error) {
        console.warn('[CameraDialog.store] Failed to save game window size:', error);
    }
    return clamped;
};

// Initialize EventBus listeners to update state when emitted from Phaser
EventBus.on(OUT_UI_SET_CAMERA_ZOOM, (zoom: number) => {
    setCameraZoom(zoom, false);
});

EventBus.on(OUT_UI_GAME_STATS_UPDATE, (stats: { 
    fps: number; 
    cameraX: number; 
    cameraY: number;
    playerSceneX: number | undefined;
    playerSceneY: number | undefined;
    playerWorldX: number | undefined;
    playerWorldY: number | undefined;
}) => {
    cameraDialogStore.setState((state) => ({
        ...state,
        fps: stats.fps,
        cameraPosition: { x: stats.cameraX, y: stats.cameraY },
        playerPosition: {
            sceneX: stats.playerSceneX,
            sceneY: stats.playerSceneY,
            worldX: stats.playerWorldX,
            worldY: stats.playerWorldY
        }
    }));
});

EventBus.on(OUT_UI_MOUSE_POSITION_UPDATE, (position: { sceneX: number; sceneY: number; worldX: number; worldY: number }) => {
    cameraDialogStore.setState((state) => ({
        ...state,
        cursorPosition: position
    }));
});

EventBus.on(OUT_UI_CAMERA_FOLLOW_PLAYER_CHANGED, (enabled: boolean) => {
    setFollowPlayer(enabled, false);
});
