import { EventBus } from '../../game/EventBus';
import { createDialogStore } from './utils';
import { OUT_UI_SET_GAME_WORLDS, OUT_UI_SET_SELECTED_MAP, IN_UI_CHANGE_MAP } from '../../constants/EventNames';

export interface GameWorld {
    id: string;
    name: string;
    map: string;
}

interface ControlsDialogState {
    isOpen: boolean;
    selectedMap: string;
    gameWorlds: GameWorld[];
    isFullscreen: boolean;
    /** Seconds remaining until logout. When set, logout is in progress and the button shows "Cancel (X)". */
    logoutSecondsRemaining: number | undefined;
}

const initialState: ControlsDialogState = {
    isOpen: false,
    selectedMap: '',
    gameWorlds: [],
    isFullscreen: false,
    logoutSecondsRemaining: undefined,
};

const { store: controlsDialogStore, toggle: toggleControlsDialog, setOpen: setControlsDialogOpen } =
    createDialogStore(initialState);

export { controlsDialogStore, toggleControlsDialog, setControlsDialogOpen };

export const setSelectedMap = (mapName: string, notifyPhaser = true) => {
    controlsDialogStore.setState((state) => ({ ...state, selectedMap: mapName }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_MAP, mapName);
    }
};

export const setGameWorlds = (gameWorlds: GameWorld[]) => {
    controlsDialogStore.setState((state) => {
        const nextSelectedMap = gameWorlds.some((world) => world.id === state.selectedMap)
            ? state.selectedMap
            : (gameWorlds[0]?.id ?? '');
        return {
            ...state,
            gameWorlds,
            selectedMap: nextSelectedMap,
        };
    });
};

export const setIsFullscreen = (isFullscreen: boolean) => {
    controlsDialogStore.setState((state) => ({ ...state, isFullscreen }));
};

export const setLogoutSecondsRemaining = (seconds: number | undefined) => {
    controlsDialogStore.setState((state) => ({ ...state, logoutSecondsRemaining: seconds }));
};

// Initialize EventBus listeners to update state when emitted from Phaser
EventBus.on(OUT_UI_SET_SELECTED_MAP, (mapName: string) => {
    setSelectedMap(mapName, false);
});

EventBus.on(OUT_UI_SET_GAME_WORLDS, (gameWorlds: GameWorld[]) => {
    setGameWorlds(gameWorlds);
});
