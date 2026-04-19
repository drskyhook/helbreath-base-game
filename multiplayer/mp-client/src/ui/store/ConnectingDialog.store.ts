import { createDialogStore } from './utils';

interface ConnectingDialogState {
    isOpen: boolean;
}

const initialState: ConnectingDialogState = {
    isOpen: false,
};

const { store: connectingDialogStore, setOpen: setConnectingDialogOpen } = createDialogStore(initialState);

export { connectingDialogStore, setConnectingDialogOpen };
