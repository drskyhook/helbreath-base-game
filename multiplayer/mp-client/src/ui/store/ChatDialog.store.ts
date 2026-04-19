import { EventBus } from '../../game/EventBus';
import { CHAT_MESSAGE_RECEIVED } from '../../constants/EventNames';
import { createDialogStore } from './utils';

export interface ChatMessageEntry {
    senderCharacterName: string;
    timestampMs: number;
    message: string;
}

interface ChatDialogState {
    isOpen: boolean;
    messages: ChatMessageEntry[];
}

const MAX_CHAT_MESSAGES = 200;

const initialState: ChatDialogState = {
    isOpen: false,
    messages: [],
};

const { store: chatDialogStore, toggle: toggleChatDialog, setOpen: setChatDialogOpen } = createDialogStore(initialState);

export { chatDialogStore, toggleChatDialog, setChatDialogOpen };

export const addChatMessage = (message: ChatMessageEntry) => {
    chatDialogStore.setState((state) => ({
        ...state,
        messages: [...state.messages, message].slice(-MAX_CHAT_MESSAGES),
    }));
};

EventBus.on(CHAT_MESSAGE_RECEIVED, (message: ChatMessageEntry) => {
    addChatMessage(message);
});
