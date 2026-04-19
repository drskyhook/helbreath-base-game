import { EventBus } from '../../game/EventBus';
import { createDialogStore } from './utils';
import { IN_UI_MAKE_SERVER_CELL_OCCUPIED_MODE, IN_UI_PLAYER_TELEPORT_REQUEST_MODE, IN_UI_CHANGE_GRACE_PERIOD } from '../../constants/EventNames';

interface ServerDialogState {
    isOpen: boolean;
    /** Simulated incoming latency in ms (0–500). */
    incomingLatency: number;
    /** Simulated outgoing latency in ms (0–500). */
    outgoingLatency: number;
    /** Extra random incoming delay in ms (0–500). When > 0, adds random(0, value) on top of incoming latency. */
    incomingFluctuation: number;
    /** Extra random outgoing delay in ms (0–500). When > 0, adds random(0, value) on top of outgoing latency. */
    outgoingFluctuation: number;
    /** Remote player idle continuation grace period in ms (0–500). */
    gracePeriod: number;
    /** When true, movement speed changes are sent to the server. */
    syncWithServer: boolean;
}

const initialState: ServerDialogState = {
    isOpen: false,
    incomingLatency: 0,
    outgoingLatency: 0,
    incomingFluctuation: 0,
    outgoingFluctuation: 0,
    gracePeriod: 100,
    syncWithServer: true,
};

const { store: serverDialogStore, toggle: toggleServerDialog, setOpen: setServerDialogOpen } =
    createDialogStore(initialState);

export { serverDialogStore, toggleServerDialog, setServerDialogOpen };

export const setIncomingLatency = (ms: number) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)));
    serverDialogStore.setState((state) => ({ ...state, incomingLatency: clamped }));
};

export const setOutgoingLatency = (ms: number) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)));
    serverDialogStore.setState((state) => ({ ...state, outgoingLatency: clamped }));
};

export const setIncomingFluctuation = (ms: number) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)));
    serverDialogStore.setState((state) => ({ ...state, incomingFluctuation: clamped }));
};

export const setOutgoingFluctuation = (ms: number) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)));
    serverDialogStore.setState((state) => ({ ...state, outgoingFluctuation: clamped }));
};

export const setSyncWithServer = (enabled: boolean) => {
    serverDialogStore.setState((state) => ({ ...state, syncWithServer: enabled }));
};

export const setGracePeriod = (ms: number, notifyPhaser = true) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)));
    serverDialogStore.setState((state) => ({ ...state, gracePeriod: clamped }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_GRACE_PERIOD, clamped);
    }
};

export const requestMakeServerCellOccupied = () => {
    EventBus.emit(IN_UI_MAKE_SERVER_CELL_OCCUPIED_MODE);
    setServerDialogOpen(false);
};

export const requestPlayerTeleportToCell = () => {
    EventBus.emit(IN_UI_PLAYER_TELEPORT_REQUEST_MODE);
    setServerDialogOpen(false);
};
