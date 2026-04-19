import { Store } from '@tanstack/react-store';
import { EventBus } from '../../game/EventBus';
import { OUT_UI_HOVER_PLAYER } from '../../constants/EventNames';
import type { PlayerHoverInfo } from '../../Types';

interface PlayerHoverOverlayState {
    playerInfo: PlayerHoverInfo | undefined;
}

const initialState: PlayerHoverOverlayState = {
    playerInfo: undefined,
};

export const playerHoverOverlayStore = new Store<PlayerHoverOverlayState>(initialState);

EventBus.on(OUT_UI_HOVER_PLAYER, (playerInfo: PlayerHoverInfo | undefined) => {
    playerHoverOverlayStore.setState((state) => ({ ...state, playerInfo }));
});
