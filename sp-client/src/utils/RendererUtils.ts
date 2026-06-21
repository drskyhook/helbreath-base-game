import type { Game } from 'phaser';
import { NATIVE_OVERLAY_RESIZE_REQUESTED } from '../constants/EventNames';
import { EventBus } from '../game/EventBus';
import { setIsFullscreen } from '../ui/store/ControlsDialog.store';

let fullscreenResizeHandler: (() => void) | undefined;
let fullscreenHandlersBound = false;
let fullscreenRefreshFrame: number | undefined;
let gameWindowScaleGame: Game | undefined;

/**
 * Canvas / Phaser display helpers (fullscreen scaling, DOM wrappers around the game).
 */

function scheduleScaleRefresh(game: Game): void {
    if (fullscreenRefreshFrame !== undefined) {
        window.cancelAnimationFrame(fullscreenRefreshFrame);
    }

    // Phaser caches canvas bounds for pointer math; refresh after CSS layout changes.
    fullscreenRefreshFrame = window.requestAnimationFrame(() => {
        fullscreenRefreshFrame = undefined;
        game.scale.refresh();
        EventBus.emit(NATIVE_OVERLAY_RESIZE_REQUESTED);
    });
}

function requestNativeOverlayResize(): void {
    EventBus.emit(NATIVE_OVERLAY_RESIZE_REQUESTED);
    window.requestAnimationFrame(() => EventBus.emit(NATIVE_OVERLAY_RESIZE_REQUESTED));
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => EventBus.emit(NATIVE_OVERLAY_RESIZE_REQUESTED));
    });
}

/** Applies saved normal-mode game-window scale using CSS variables on the canvas container. */
export function applyGameWindowSizePercent(percent: number, game?: Game | null): void {
    const container = document.getElementById('game-container');
    if (!container) {
        return;
    }

    if (game) {
        gameWindowScaleGame = game;
    }

    const activeGame = game ?? gameWindowScaleGame;
    const canvas = activeGame?.canvas ?? container.querySelector('canvas');
    const baseWidth = activeGame ? Number(activeGame.config.width) : canvas instanceof HTMLCanvasElement ? canvas.width : 1024;
    const baseHeight = activeGame ? Number(activeGame.config.height) : canvas instanceof HTMLCanvasElement ? canvas.height : 576;
    const scale = percent / 100;

    container.style.setProperty('--game-window-scale', String(scale));
    container.style.setProperty('--game-canvas-base-width', `${baseWidth}px`);
    container.style.setProperty('--game-canvas-base-height', `${baseHeight}px`);
    container.style.setProperty('--game-canvas-display-width', `${baseWidth * scale}px`);
    container.style.setProperty('--game-canvas-display-height', `${baseHeight * scale}px`);
    requestNativeOverlayResize();

    if (activeGame && !activeGame.scale.isFullscreen) {
        scheduleScaleRefresh(activeGame);
    }
}

/**
 * Toggles Phaser fullscreen on `#game-wrapper` / `#game-container`. Binds scale enter/leave listeners
 * once; updates canvas CSS scale so pointer math stays aligned after layout changes.
 */
export function togglePhaserFullscreen(game: Game | null | undefined): void {
    if (!game) {
        return;
    }

    const wrapper = document.getElementById('game-wrapper');
    const container = document.getElementById('game-container');
    const canvas = game.canvas;
    const baseWidth = Number(game.config.width);
    const baseHeight = Number(game.config.height);

    const applyFullscreenScale = () => {
        const fullscreenWidth = wrapper?.clientWidth ?? window.innerWidth;
        const fullscreenHeight = wrapper?.clientHeight ?? window.innerHeight;
        const scale = Math.min(fullscreenWidth / baseWidth, fullscreenHeight / baseHeight);
        canvas.style.width = `${baseWidth}px`;
        canvas.style.height = `${baseHeight}px`;
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = '50%';
        canvas.style.margin = '0';
        canvas.style.transformOrigin = 'center center';
        canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
        requestNativeOverlayResize();
        scheduleScaleRefresh(game);
    };

    const clearFullscreenScale = () => {
        wrapper?.classList.remove('fullscreen');
        container?.classList.remove('fullscreen');
        canvas.classList.remove('fullscreen');
        canvas.style.removeProperty('width');
        canvas.style.removeProperty('height');
        canvas.style.removeProperty('position');
        canvas.style.removeProperty('left');
        canvas.style.removeProperty('top');
        canvas.style.removeProperty('margin');
        canvas.style.removeProperty('transform');
        canvas.style.removeProperty('transform-origin');
        if (fullscreenRefreshFrame !== undefined) {
            window.cancelAnimationFrame(fullscreenRefreshFrame);
            fullscreenRefreshFrame = undefined;
        }
        if (fullscreenResizeHandler) {
            window.removeEventListener('resize', fullscreenResizeHandler);
            fullscreenResizeHandler = undefined;
        }
        requestNativeOverlayResize();
        scheduleScaleRefresh(game);
    };

    if (!fullscreenHandlersBound) {
        game.scale.on('enterfullscreen', () => {
            wrapper?.classList.add('fullscreen');
            container?.classList.add('fullscreen');
            canvas.classList.add('fullscreen');
            applyFullscreenScale();
            fullscreenResizeHandler = applyFullscreenScale;
            window.addEventListener('resize', applyFullscreenScale);
            setIsFullscreen(true);
        });

        game.scale.on('leavefullscreen', () => {
            clearFullscreenScale();
            setIsFullscreen(false);
        });

        fullscreenHandlersBound = true;
    }

    if (game.scale.isFullscreen) {
        game.scale.stopFullscreen();
    } else {
        game.scale.startFullscreen();
    }
}
