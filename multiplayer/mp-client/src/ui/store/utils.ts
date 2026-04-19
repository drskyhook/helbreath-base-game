import { Store } from '@tanstack/react-store';

/** Minimum shape for dialog visibility; extend with dialog-specific fields. */
export type DialogStoreShape = { isOpen: boolean };

/**
 * Shared TanStack Store factory for dialogs: `isOpen`, `toggle`, `setOpen`.
 * Keeps open/close logic in one place instead of duplicating per dialog file.
 */
export function createDialogStore<T extends DialogStoreShape>(initialState: T) {
    const store = new Store<T>(initialState);

    const toggle = () => {
        store.setState((s) => ({ ...s, isOpen: !s.isOpen }));
    };

    const setOpen = (isOpen: boolean) => {
        store.setState((s) => ({ ...s, isOpen }));
    };

    return { store, toggle, setOpen } as const;
}
