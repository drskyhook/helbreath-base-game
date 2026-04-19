import { EventBus } from '../../game/EventBus';
import { SERVER_MESSAGE_RECEIVED } from '../../constants/EventNames';
import { createDialogStore } from './utils';

interface ServerMessageDialogState {
    isOpen: boolean;
    message: string;
}

const initialState: ServerMessageDialogState = {
    isOpen: false,
    message: '',
};

const { store: serverMessageDialogStore, setOpen: setServerMessageDialogOpen } = createDialogStore(initialState);

export { serverMessageDialogStore, setServerMessageDialogOpen };

export const setServerMessageDialogMessage = (message: string) => {
    serverMessageDialogStore.setState((state) => ({ ...state, message }));
};

EventBus.on(SERVER_MESSAGE_RECEIVED, ({ message }: { message: string }) => {
    setServerMessageDialogMessage(message);
    setServerMessageDialogOpen(true);
});
