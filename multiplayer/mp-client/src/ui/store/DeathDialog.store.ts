import { EventBus } from '../../game/EventBus';
import { OUT_UI_PLAYER_DIED } from '../../constants/EventNames';
import { createDialogStore } from './utils';

interface DeathDialogState {
    isOpen: boolean;
}

const initialState: DeathDialogState = {
    isOpen: false,
};

const { store: deathDialogStore, setOpen: setDeathDialogOpen } = createDialogStore(initialState);

export { deathDialogStore, setDeathDialogOpen };

// Initialize EventBus listener to show death dialog when player dies
EventBus.on(OUT_UI_PLAYER_DIED, () => {
    setDeathDialogOpen(true);
});
