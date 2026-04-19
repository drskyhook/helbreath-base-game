import { useEffect, useState } from 'react';

function computeFullscreenPortalRoot(): HTMLElement {
    return document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body;
}

/**
 * Portal root for overlay UI during fullscreen: `document.fullscreenElement` when set, else `document.body`.
 * Optionally notifies when the root changes (e.g. sync into a TanStack store for tooltips).
 */
export function useFullscreenPortalTarget(onTargetChange?: (target: HTMLElement) => void): HTMLElement | undefined {
    const [portalTarget, setPortalTarget] = useState<HTMLElement | undefined>(undefined);

    useEffect(() => {
        const update = () => {
            const el = computeFullscreenPortalRoot();
            setPortalTarget(el);
            onTargetChange?.(el);
        };

        update();
        document.addEventListener('fullscreenchange', update);
        return () => {
            document.removeEventListener('fullscreenchange', update);
        };
    }, [onTargetChange]);

    return portalTarget;
}
