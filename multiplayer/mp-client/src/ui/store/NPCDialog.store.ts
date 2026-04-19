import { EventBus } from '../../game/EventBus';
import { IN_UI_KILL_ALL_NPCS, IN_UI_SUMMON_NPC, OUT_UI_SET_NPC_DIRECTORY } from '../../constants/EventNames';
import { Direction } from '../../utils/CoordinateUtils';
import { createDialogStore } from './utils';

export interface NpcDirectoryOption {
    id: number;
    name: string;
}

interface NPCDialogState {
    isOpen: boolean;
    /** Server catalog id as string (select value). */
    selectedCatalogId: string;
    selectedDirection: Direction;
    directoryOptions: NpcDirectoryOption[];
}

const initialState: NPCDialogState = {
    isOpen: false,
    selectedCatalogId: '0',
    selectedDirection: Direction.South,
    directoryOptions: [],
};

const { store: npcDialogStore, toggle: toggleNPCDialog, setOpen: setNPCDialogOpen } = createDialogStore(initialState);

export { npcDialogStore, toggleNPCDialog, setNPCDialogOpen };

export const setSelectedCatalogId = (catalogId: string) => {
    npcDialogStore.setState((state) => ({ ...state, selectedCatalogId: catalogId }));
};

export const setSelectedDirection = (direction: Direction) => {
    npcDialogStore.setState((state) => ({ ...state, selectedDirection: direction }));
};

export const summonNPC = () => {
    const state = npcDialogStore.state;
    EventBus.emit(IN_UI_SUMMON_NPC, {
        catalogNpcId: Number(state.selectedCatalogId),
        direction: state.selectedDirection,
    });
};

EventBus.on(OUT_UI_SET_NPC_DIRECTORY, (rows: NpcDirectoryOption[]) => {
    npcDialogStore.setState((s) => {
        const directoryOptions = rows.slice().sort((a, b) => a.id - b.id);
        const firstId = directoryOptions[0]?.id;
        const selectedCatalogId =
            firstId !== undefined && !directoryOptions.some((o) => String(o.id) === s.selectedCatalogId)
                ? String(firstId)
                : s.selectedCatalogId;
        return { ...s, directoryOptions, selectedCatalogId };
    });
});

export const requestKillAllNpcs = () => {
    EventBus.emit(IN_UI_KILL_ALL_NPCS);
};
