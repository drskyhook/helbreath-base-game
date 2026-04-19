import { EventBus } from '../../game/EventBus';
import { IN_UI_CAST_SPELL, OUT_UI_SET_SPELLS } from '../../constants/EventNames';
import type { CastSpellEvent, SpellEntry } from '../../Types';
import { createDialogStore } from './utils';

interface CastDialogState {
    isOpen: boolean;
    spells: SpellEntry[];
    selectedSpellId: number | undefined;
}

const initialState: CastDialogState = {
    isOpen: false,
    spells: [],
    selectedSpellId: undefined,
};

const { store: castDialogStore, toggle: toggleCastDialog, setOpen: setCastDialogOpen } = createDialogStore(initialState);

export { castDialogStore, toggleCastDialog, setCastDialogOpen };

export const setSelectedSpellId = (spellId: number) => {
    castDialogStore.setState((state) => ({ ...state, selectedSpellId: spellId }));
};

export const setSpells = (spells: SpellEntry[]) => {
    castDialogStore.setState((state) => {
        const sorted = [...spells].sort((a, b) => a.id - b.id);
        const nextSelectedSpellId = sorted.some((spell) => spell.id === state.selectedSpellId)
            ? state.selectedSpellId
            : sorted[0]?.id;
        return {
            ...state,
            spells: sorted,
            selectedSpellId: nextSelectedSpellId,
        };
    });
};

export const castSpell = () => {
    const state = castDialogStore.state;
    if (state.selectedSpellId === undefined) {
        return;
    }
    EventBus.emit(IN_UI_CAST_SPELL, {
        spellId: state.selectedSpellId,
    } satisfies CastSpellEvent);
    setCastDialogOpen(false);
};

EventBus.on(OUT_UI_SET_SPELLS, (spells: SpellEntry[]) => {
    setSpells(spells);
});
