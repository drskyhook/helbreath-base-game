import { EventBus } from '../../game/EventBus';
import { createDialogStore } from './utils';
import {
    IN_UI_TOGGLE_RENDER_MAP_TILES,
    IN_UI_TOGGLE_RENDER_MAP_OBJECTS,
    IN_UI_TOGGLE_DEBUG_MODE,
    IN_UI_TOGGLE_NON_MOVABLE_CELLS_HIGHLIGHT,
    IN_UI_TOGGLE_TELEPORT_CELLS_HIGHLIGHT,
    IN_UI_TOGGLE_SERVER_TELEPORT_CELLS_HIGHLIGHT,
    IN_UI_TOGGLE_WATER_CELLS_HIGHLIGHT,
    IN_UI_TOGGLE_FARMABLE_CELLS_HIGHLIGHT,
    IN_UI_TOGGLE_GRID_DISPLAY,
    IN_UI_TOGGLE_DISPLAY_LARGE_ITEMS,
    IN_UI_CHANGE_WEATHER,
} from '../../constants/EventNames';

/** Weather mode: dry (no effects), rain, or snow intensity levels */
export type WeatherMode = 'dry' | 'rain-light' | 'rain-medium' | 'rain-heavy' | 'snow-light' | 'snow-medium' | 'snow-heavy';

interface MapDialogState {
    isOpen: boolean;
    renderMapTiles: boolean;
    renderMapObjects: boolean;
    debugMode: boolean;
    showNonMovableCells: boolean;
    showTeleportCells: boolean;
    showServerTeleportCells: boolean;
    showWaterCells: boolean;
    showFarmableCells: boolean;
    displayGrid: boolean;
    displayLargeItems: boolean;
    weather: WeatherMode;
}

const initialState: MapDialogState = {
    isOpen: false,
    renderMapTiles: true,
    renderMapObjects: true,
    debugMode: false,
    showNonMovableCells: false,
    showTeleportCells: false,
    showServerTeleportCells: false,
    showWaterCells: false,
    showFarmableCells: false,
    displayGrid: false,
    displayLargeItems: false,
    weather: 'dry',
};

const { store: mapDialogStore, toggle: toggleMapDialog, setOpen: setMapDialogOpen } = createDialogStore(initialState);

export { mapDialogStore, toggleMapDialog, setMapDialogOpen };

// Helper functions to update individual fields
export const setRenderMapTiles = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, renderMapTiles: value }));
    EventBus.emit(IN_UI_TOGGLE_RENDER_MAP_TILES, value);
};

export const setRenderMapObjects = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, renderMapObjects: value }));
    EventBus.emit(IN_UI_TOGGLE_RENDER_MAP_OBJECTS, value);
};

export const setDebugMode = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, debugMode: value }));
    EventBus.emit(IN_UI_TOGGLE_DEBUG_MODE, value);
};

export const setShowNonMovableCells = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, showNonMovableCells: value }));
    EventBus.emit(IN_UI_TOGGLE_NON_MOVABLE_CELLS_HIGHLIGHT, value);
};

export const setShowTeleportCells = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, showTeleportCells: value }));
    EventBus.emit(IN_UI_TOGGLE_TELEPORT_CELLS_HIGHLIGHT, value);
};

export const setShowServerTeleportCells = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, showServerTeleportCells: value }));
    EventBus.emit(IN_UI_TOGGLE_SERVER_TELEPORT_CELLS_HIGHLIGHT, value);
};

export const setShowWaterCells = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, showWaterCells: value }));
    EventBus.emit(IN_UI_TOGGLE_WATER_CELLS_HIGHLIGHT, value);
};

export const setShowFarmableCells = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, showFarmableCells: value }));
    EventBus.emit(IN_UI_TOGGLE_FARMABLE_CELLS_HIGHLIGHT, value);
};

export const setDisplayGrid = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, displayGrid: value }));
    EventBus.emit(IN_UI_TOGGLE_GRID_DISPLAY, value);
};

export const setDisplayLargeItems = (value: boolean) => {
    mapDialogStore.setState((state) => ({ ...state, displayLargeItems: value }));
    EventBus.emit(IN_UI_TOGGLE_DISPLAY_LARGE_ITEMS, value);
};

export const setWeather = (value: WeatherMode) => {
    mapDialogStore.setState((state) => ({ ...state, weather: value }));
    EventBus.emit(IN_UI_CHANGE_WEATHER, value);
};

/** Updates the Map dialog weather without emitting IN_UI (network snapshot / OUT_WEATHER). */
export const syncWeather = (value: WeatherMode) => {
    mapDialogStore.setState((state) => ({ ...state, weather: value }));
};

// Helper function to reset to defaults (for ControlsDialog)
export const resetMapDialogToDefaults = () => {
    mapDialogStore.setState((state) => ({
        ...state,
        renderMapTiles: true,
        renderMapObjects: true,
        showNonMovableCells: false,
        showTeleportCells: false,
        showServerTeleportCells: false,
        showWaterCells: false,
        showFarmableCells: false,
        displayGrid: false,
        displayLargeItems: false,
        weather: 'dry',
        // Note: debugMode is preserved and not reset
    }));
};
