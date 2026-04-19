import { Store } from '@tanstack/react-store';
import { EventBus } from '../../game/EventBus';
import { OUT_UI_HOVER_NPC } from '../../constants/EventNames';
import type { NpcHoverInfo } from '../../Types';

interface NpcHoverOverlayState {
    npcInfo: NpcHoverInfo | undefined;
}

const initialState: NpcHoverOverlayState = {
    npcInfo: undefined,
};

export const npcHoverOverlayStore = new Store<NpcHoverOverlayState>(initialState);

EventBus.on(OUT_UI_HOVER_NPC, (npcInfo: NpcHoverInfo | undefined) => {
    npcHoverOverlayStore.setState((state) => ({ ...state, npcInfo }));
});
