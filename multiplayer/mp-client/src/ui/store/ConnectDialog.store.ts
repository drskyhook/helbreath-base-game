import { createDialogStore } from './utils';

export interface ConnectDialogState {
    isOpen: boolean;
    /** Prefill from GameStateManager when opening the login screen */
    defaultCharacterName: string;
    /** Last submit attempt; restores fields after a failed connection */
    lastAttempt: { characterName: string; host: string; port: number } | null;
}

const initialState: ConnectDialogState = {
    isOpen: false,
    defaultCharacterName: '',
    lastAttempt: null,
};

const { store: connectDialogStore, setOpen: setConnectDialogOpen } = createDialogStore(initialState);

export { connectDialogStore, setConnectDialogOpen };

/** Opens the connect dialog for a fresh login attempt (clears last-attempt restore). */
export const openConnectDialogForLogin = (defaultCharacterName: string) => {
    connectDialogStore.setState(() => ({
        isOpen: true,
        defaultCharacterName,
        lastAttempt: null,
    }));
};

export const setLastConnectAttempt = (attempt: { characterName: string; host: string; port: number }) => {
    connectDialogStore.setState((state) => ({ ...state, lastAttempt: attempt }));
};
