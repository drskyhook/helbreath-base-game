import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { Scene } from 'phaser';
import {
    NATIVE_OVERLAY_FLOATING_TEXT_REQUESTED,
    NATIVE_OVERLAY_HEALTH_BAR_HIDDEN,
    NATIVE_OVERLAY_HEALTH_BAR_UPDATED,
    NATIVE_OVERLAY_LOGIN_BACKGROUND_HIDDEN,
    NATIVE_OVERLAY_LOGIN_BACKGROUND_SHOWN,
    NATIVE_OVERLAY_LOADING_SCREEN_HIDDEN,
    NATIVE_OVERLAY_LOADING_SCREEN_PROGRESS,
    NATIVE_OVERLAY_LOADING_SCREEN_SHOWN,
    NATIVE_OVERLAY_LOGOUT_COUNTDOWN_HIDDEN,
    NATIVE_OVERLAY_LOGOUT_COUNTDOWN_UPDATED,
    NATIVE_OVERLAY_MAP_LOADING_HIDDEN,
    NATIVE_OVERLAY_MAP_LOADING_SHOWN,
    NATIVE_OVERLAY_RESIZE_REQUESTED,
} from '../../constants/EventNames';
import { EventBus } from '../../game/EventBus';
import type { NativeFloatingTextPayload } from '../../game/effects/FloatingText';

type NativeOverlayCanvasProps = {
    gameRef: RefObject<Phaser.Game | null>;
};

type OverlayBounds = {
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
    dpr: number;
    contentOffsetX: number;
    contentOffsetY: number;
};

type ActiveFloatingText = NativeFloatingTextPayload & {
    createdAtMs: number;
};

export type NativeOverlayHealthBarPayload = {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    hpRatio: number;
    trackColor: string;
    fillColor: string;
    borderColor: string;
};

export type NativeOverlayMapLoadingPayload = {
    text: string;
};

export type NativeOverlayLoginBackgroundPayload = {
    imageSrc: string;
};

export type NativeOverlayLoadingScreenPayload = {
    imageSrc: string;
};

export type NativeOverlayLoadingScreenProgressPayload = {
    progress: number;
};

export type NativeOverlayLogoutCountdownPayload = {
    text: string;
};

const DEFAULT_BOUNDS: OverlayBounds = {
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    dpr: 1,
    contentOffsetX: 0,
    contentOffsetY: 0,
};

/**
 * Browser-side canvas stacked above Phaser for high-DPI effects that should not inherit Phaser pixelation.
 */
export function NativeOverlayCanvas({ gameRef }: NativeOverlayCanvasProps) {
    const [overlayBackgroundSrc, setOverlayBackgroundSrc] = useState<string | undefined>();
    const [loadingProgressVisible, setLoadingProgressVisible] = useState(false);
    const [loginTitleVisible, setLoginTitleVisible] = useState(false);
    const [logoutCountdownOverlay, setLogoutCountdownOverlay] = useState<NativeOverlayLogoutCountdownPayload | undefined>();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sceneBackgroundRef = useRef<HTMLImageElement | null>(null);
    const loadingProgressRef = useRef<HTMLDivElement | null>(null);
    const loginTitleRef = useRef<HTMLDivElement | null>(null);
    const loginTitleMainRef = useRef<HTMLHeadingElement | null>(null);
    const loginTitleSubtitleRef = useRef<HTMLParagraphElement | null>(null);
    const logoutCountdownLabelRef = useRef<HTMLDivElement | null>(null);
    const boundsRef = useRef<OverlayBounds>(DEFAULT_BOUNDS);
    const floatingTextsRef = useRef<ActiveFloatingText[]>([]);
    const healthBarRef = useRef<NativeOverlayHealthBarPayload | undefined>(undefined);
    const loadingScreenProgressRef = useRef(0);
    const mapLoadingVisibleRef = useRef(false);
    const mapLoadingTextRef = useRef('Loading map...');
    const mapLoadingDrawLoggedRef = useRef(false);
    const logoutCountdownRef = useRef<NativeOverlayLogoutCountdownPayload | undefined>(undefined);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const resizeFrameRef = useRef<number | undefined>(undefined);
    const resizeSettleFrameRef = useRef<number | undefined>(undefined);
    const boundsTrackingFrameRef = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            console.warn('[NativeOverlayCanvas] 2D canvas context unavailable');
            return;
        }

        const render = (timeMs: number) => {
            animationFrameRef.current = undefined;
            drawOverlay(
                context,
                boundsRef.current,
                floatingTextsRef.current,
                healthBarRef.current,
                logoutCountdownRef.current,
                mapLoadingVisibleRef.current,
                mapLoadingTextRef.current,
                mapLoadingDrawLoggedRef,
                timeMs,
            );

            if (
                floatingTextsRef.current.length > 0 ||
                healthBarRef.current ||
                logoutCountdownRef.current ||
                mapLoadingVisibleRef.current
            ) {
                animationFrameRef.current = window.requestAnimationFrame(render);
            }
        };

        const ensureAnimationFrame = () => {
            if (animationFrameRef.current !== undefined) {
                return;
            }

            animationFrameRef.current = window.requestAnimationFrame(render);
        };

        let disposed = false;
        let observedPhaserCanvas: HTMLCanvasElement | undefined;
        let resizeSettleFramesRemaining = 0;
        const resizeObserver = new ResizeObserver(() => {
            scheduleBoundsSync();
        });
        const mutationObserver = new MutationObserver(() => {
            scheduleBoundsSync();
        });

        const syncBounds = (allowRetry = true) => {
            resizeFrameRef.current = undefined;
            if (disposed) {
                return;
            }

            const game = gameRef.current;
            const wrapper = document.getElementById('game-wrapper');
            const container = document.getElementById('game-container');
            if (!game || !wrapper || !container) {
                if (allowRetry) {
                    scheduleBoundsSync();
                }
                return;
            }

            const phaserCanvas = game.canvas;
            if (observedPhaserCanvas !== phaserCanvas) {
                if (observedPhaserCanvas) {
                    resizeObserver.unobserve(observedPhaserCanvas);
                }
                resizeObserver.observe(phaserCanvas);
                mutationObserver.observe(phaserCanvas, {
                    attributes: true,
                    attributeFilter: ['class', 'style'],
                });
                observedPhaserCanvas = phaserCanvas;
            }

            const canvasRect = phaserCanvas.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();
            const style = window.getComputedStyle(phaserCanvas);
            const borderScaleX = phaserCanvas.offsetWidth > 0 ? canvasRect.width / phaserCanvas.offsetWidth : 1;
            const borderScaleY = phaserCanvas.offsetHeight > 0 ? canvasRect.height / phaserCanvas.offsetHeight : 1;
            const borderLeft = parseCssPixelValue(style.borderLeftWidth) * borderScaleX;
            const borderRight = parseCssPixelValue(style.borderRightWidth) * borderScaleX;
            const borderTop = parseCssPixelValue(style.borderTopWidth) * borderScaleY;
            const borderBottom = parseCssPixelValue(style.borderBottomWidth) * borderScaleY;
            const width = Math.max(0, canvasRect.width);
            const height = Math.max(0, canvasRect.height);
            const contentWidth = Math.max(0, width - borderLeft - borderRight);
            const contentHeight = Math.max(0, height - borderTop - borderBottom);
            const overlayLeft = canvasRect.left - wrapperRect.left + borderLeft;
            const overlayTop = canvasRect.top - wrapperRect.top + borderTop;
            const dpr = window.devicePixelRatio || 1;

            setStylePixelValue(canvas, 'left', overlayLeft);
            setStylePixelValue(canvas, 'top', overlayTop);
            setStylePixelValue(canvas, 'width', contentWidth);
            setStylePixelValue(canvas, 'height', contentHeight);
            const sceneBackground = sceneBackgroundRef.current;
            if (sceneBackground) {
                setStylePixelValue(sceneBackground, 'left', overlayLeft);
                setStylePixelValue(sceneBackground, 'top', overlayTop);
                setStylePixelValue(sceneBackground, 'width', contentWidth);
                setStylePixelValue(sceneBackground, 'height', contentHeight);
            }

            const backingWidth = Math.max(1, Math.round(contentWidth * dpr));
            const backingHeight = Math.max(1, Math.round(contentHeight * dpr));
            if (canvas.width !== backingWidth) {
                canvas.width = backingWidth;
            }
            if (canvas.height !== backingHeight) {
                canvas.height = backingHeight;
            }

            const baseWidth = Number(game.config.width);
            const baseHeight = Number(game.config.height);
            const scaleX = baseWidth > 0 ? contentWidth / baseWidth : 1;
            const scaleY = baseHeight > 0 ? contentHeight / baseHeight : 1;
            boundsRef.current = {
                width: contentWidth,
                height: contentHeight,
                scaleX,
                scaleY,
                dpr,
                contentOffsetX: 0,
                contentOffsetY: 0,
            };

            const loadingProgress = loadingProgressRef.current;
            if (loadingProgress) {
                const progressWidth = 320 * scaleX;
                const progressHeight = 12 * scaleY;
                const progressBottom = 40 * scaleY;
                setStylePixelValue(loadingProgress, 'left', overlayLeft + contentWidth / 2 - progressWidth / 2);
                setStylePixelValue(loadingProgress, 'top', overlayTop + contentHeight - progressBottom - progressHeight / 2);
                setStylePixelValue(loadingProgress, 'width', progressWidth);
                setStylePixelValue(loadingProgress, 'height', progressHeight);
            }

            const loginTitle = loginTitleRef.current;
            const loginTitleMain = loginTitleMainRef.current;
            const loginTitleSubtitle = loginTitleSubtitleRef.current;
            if (loginTitle && loginTitleMain && loginTitleSubtitle) {
                applyLoginTitleLayout(
                    loginTitle,
                    loginTitleMain,
                    loginTitleSubtitle,
                    overlayLeft,
                    overlayTop,
                    contentWidth,
                    contentHeight,
                    scaleY,
                );
            }

            const logoutLabel = logoutCountdownLabelRef.current;
            if (logoutLabel) {
                const metrics = getLogoutCountdownMetrics(boundsRef.current);
                setStylePixelValue(logoutLabel, 'left', overlayLeft);
                setStylePixelValue(logoutLabel, 'top', overlayTop + metrics.top);
                setStylePixelValue(logoutLabel, 'width', contentWidth);
                setStylePixelValue(logoutLabel, 'height', metrics.height);
                logoutLabel.style.fontSize = `${Math.max(22, Math.round(22 * Math.max(scaleX, scaleY)))}px`;
            }

            if (
                floatingTextsRef.current.length > 0 ||
                healthBarRef.current ||
                logoutCountdownRef.current ||
                mapLoadingVisibleRef.current
            ) {
                ensureAnimationFrame();
            } else {
                clearOverlay(context, boundsRef.current);
            }

            if (resizeSettleFramesRemaining > 0) {
                resizeSettleFramesRemaining--;
                resizeSettleFrameRef.current = window.requestAnimationFrame(() => syncBounds());
            } else {
                resizeSettleFrameRef.current = undefined;
            }
        };

        const scheduleBoundsSync = () => {
            if (disposed) {
                return;
            }

            if (resizeFrameRef.current !== undefined) {
                return;
            }

            resizeFrameRef.current = window.requestAnimationFrame(() => syncBounds());
        };

        const scheduleSettledBoundsSync = () => {
            resizeSettleFramesRemaining = 8;
            scheduleBoundsSync();
        };

        const addFloatingText = (payload: NativeFloatingTextPayload) => {
            floatingTextsRef.current.push({ ...payload, createdAtMs: performance.now() });
            ensureAnimationFrame();
        };

        const showSceneBackground = (imageSrc: string) => {
            setOverlayBackgroundSrc((current) => (current === imageSrc ? current : imageSrc));
        };

        const showLoginBackground = (payload: NativeOverlayLoginBackgroundPayload) => {
            showSceneBackground(payload.imageSrc);
            setLoginTitleVisible(true);
        };

        const hideLoginBackground = () => {
            setOverlayBackgroundSrc(undefined);
            setLoadingProgressVisible(false);
            setLoginTitleVisible(false);
        };

        const showLoadingScreen = (payload: NativeOverlayLoadingScreenPayload) => {
            loadingScreenProgressRef.current = 0;
            showSceneBackground(payload.imageSrc);
            setLoadingProgressVisible(true);
        };

        const updateLoadingScreenProgress = (payload: NativeOverlayLoadingScreenProgressPayload) => {
            loadingScreenProgressRef.current = Math.max(0, Math.min(1, payload.progress));
            const fill = loadingProgressRef.current?.querySelector<HTMLElement>('.native-overlay-loading-progress-fill');
            if (fill) {
                fill.style.width = `${loadingScreenProgressRef.current * 100}%`;
            }
        };

        const hideLoadingScreen = () => {
            setLoadingProgressVisible(false);
        };

        const updateHealthBar = (payload: NativeOverlayHealthBarPayload) => {
            if (mapLoadingVisibleRef.current) {
                return;
            }

            healthBarRef.current = payload;
            ensureAnimationFrame();
        };

        const hideHealthBar = () => {
            healthBarRef.current = undefined;
            if (
                floatingTextsRef.current.length === 0 &&
                !mapLoadingVisibleRef.current &&
                !logoutCountdownRef.current
            ) {
                clearOverlay(context, boundsRef.current);
            }
        };

        const showMapLoading = (payload?: NativeOverlayMapLoadingPayload) => {
            if (payload?.text) {
                mapLoadingTextRef.current = payload.text;
            }
            const wasVisible = mapLoadingVisibleRef.current;
            mapLoadingVisibleRef.current = true;
            if (!wasVisible) {
                mapLoadingDrawLoggedRef.current = false;
            }
            healthBarRef.current = undefined;
            ensureAnimationFrame();
        };

        const hideMapLoading = () => {
            mapLoadingVisibleRef.current = false;
            mapLoadingDrawLoggedRef.current = false;
            if (
                floatingTextsRef.current.length === 0 &&
                !healthBarRef.current &&
                !logoutCountdownRef.current
            ) {
                clearOverlay(context, boundsRef.current);
            }
        };

        const updateLogoutCountdown = (payload: NativeOverlayLogoutCountdownPayload) => {
            logoutCountdownRef.current = payload;
            setLogoutCountdownOverlay((current) => (current?.text === payload.text ? current : payload));
            ensureAnimationFrame();
        };

        const hideLogoutCountdown = () => {
            logoutCountdownRef.current = undefined;
            setLogoutCountdownOverlay(undefined);
            if (
                floatingTextsRef.current.length === 0 &&
                !healthBarRef.current &&
                !mapLoadingVisibleRef.current
            ) {
                clearOverlay(context, boundsRef.current);
            }
        };

        const trackBounds = () => {
            syncBounds(false);
            if (!disposed) {
                boundsTrackingFrameRef.current = window.requestAnimationFrame(trackBounds);
            }
        };

        const wrapper = document.getElementById('game-wrapper');
        const container = document.getElementById('game-container');
        if (wrapper) {
            resizeObserver.observe(wrapper);
            mutationObserver.observe(wrapper, {
                attributes: true,
                attributeFilter: ['class', 'style'],
            });
        }
        if (container) {
            resizeObserver.observe(container);
            mutationObserver.observe(container, {
                attributes: true,
                attributeFilter: ['class', 'style'],
            });
        }

        EventBus.on(NATIVE_OVERLAY_FLOATING_TEXT_REQUESTED, addFloatingText);
        EventBus.on(NATIVE_OVERLAY_LOGIN_BACKGROUND_SHOWN, showLoginBackground);
        EventBus.on(NATIVE_OVERLAY_LOGIN_BACKGROUND_HIDDEN, hideLoginBackground);
        EventBus.on(NATIVE_OVERLAY_LOADING_SCREEN_SHOWN, showLoadingScreen);
        EventBus.on(NATIVE_OVERLAY_LOADING_SCREEN_PROGRESS, updateLoadingScreenProgress);
        EventBus.on(NATIVE_OVERLAY_LOADING_SCREEN_HIDDEN, hideLoadingScreen);
        EventBus.on(NATIVE_OVERLAY_MAP_LOADING_SHOWN, showMapLoading);
        EventBus.on(NATIVE_OVERLAY_MAP_LOADING_HIDDEN, hideMapLoading);
        EventBus.on(NATIVE_OVERLAY_HEALTH_BAR_UPDATED, updateHealthBar);
        EventBus.on(NATIVE_OVERLAY_HEALTH_BAR_HIDDEN, hideHealthBar);
        EventBus.on(NATIVE_OVERLAY_LOGOUT_COUNTDOWN_UPDATED, updateLogoutCountdown);
        EventBus.on(NATIVE_OVERLAY_LOGOUT_COUNTDOWN_HIDDEN, hideLogoutCountdown);
        EventBus.on(NATIVE_OVERLAY_RESIZE_REQUESTED, scheduleSettledBoundsSync);
        document.addEventListener('fullscreenchange', scheduleSettledBoundsSync);
        window.addEventListener('resize', scheduleSettledBoundsSync);
        scheduleSettledBoundsSync();
        boundsTrackingFrameRef.current = window.requestAnimationFrame(trackBounds);

        return () => {
            disposed = true;
            EventBus.off(NATIVE_OVERLAY_FLOATING_TEXT_REQUESTED, addFloatingText);
            EventBus.off(NATIVE_OVERLAY_LOGIN_BACKGROUND_SHOWN, showLoginBackground);
            EventBus.off(NATIVE_OVERLAY_LOGIN_BACKGROUND_HIDDEN, hideLoginBackground);
            EventBus.off(NATIVE_OVERLAY_LOADING_SCREEN_SHOWN, showLoadingScreen);
            EventBus.off(NATIVE_OVERLAY_LOADING_SCREEN_PROGRESS, updateLoadingScreenProgress);
            EventBus.off(NATIVE_OVERLAY_LOADING_SCREEN_HIDDEN, hideLoadingScreen);
            EventBus.off(NATIVE_OVERLAY_MAP_LOADING_SHOWN, showMapLoading);
            EventBus.off(NATIVE_OVERLAY_MAP_LOADING_HIDDEN, hideMapLoading);
            EventBus.off(NATIVE_OVERLAY_HEALTH_BAR_UPDATED, updateHealthBar);
            EventBus.off(NATIVE_OVERLAY_HEALTH_BAR_HIDDEN, hideHealthBar);
            EventBus.off(NATIVE_OVERLAY_LOGOUT_COUNTDOWN_UPDATED, updateLogoutCountdown);
            EventBus.off(NATIVE_OVERLAY_LOGOUT_COUNTDOWN_HIDDEN, hideLogoutCountdown);
            EventBus.off(NATIVE_OVERLAY_RESIZE_REQUESTED, scheduleSettledBoundsSync);
            document.removeEventListener('fullscreenchange', scheduleSettledBoundsSync);
            window.removeEventListener('resize', scheduleSettledBoundsSync);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            if (animationFrameRef.current !== undefined) {
                window.cancelAnimationFrame(animationFrameRef.current);
            }
            if (resizeFrameRef.current !== undefined) {
                window.cancelAnimationFrame(resizeFrameRef.current);
            }
            if (resizeSettleFrameRef.current !== undefined) {
                window.cancelAnimationFrame(resizeSettleFrameRef.current);
            }
            if (boundsTrackingFrameRef.current !== undefined) {
                window.cancelAnimationFrame(boundsTrackingFrameRef.current);
            }
        };
    }, [gameRef]);

    return (
        <>
            {overlayBackgroundSrc ? (
                <img
                    ref={sceneBackgroundRef}
                    className="native-overlay-background"
                    src={overlayBackgroundSrc}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                />
            ) : null}
            {loadingProgressVisible ? (
                <div ref={loadingProgressRef} className="native-overlay-loading-progress" aria-hidden="true">
                    <div
                        className="native-overlay-loading-progress-fill"
                        style={{ width: `${loadingScreenProgressRef.current * 100}%` }}
                    />
                </div>
            ) : null}
            {loginTitleVisible ? (
                <div ref={loginTitleRef} className="native-overlay-login-title" aria-hidden="true">
                    <h1 ref={loginTitleMainRef} className="native-overlay-login-title__main">
                        Helbreath
                    </h1>
                    <p ref={loginTitleSubtitleRef} className="native-overlay-login-title__subtitle">
                        Explorer
                    </p>
                </div>
            ) : null}
            <canvas ref={canvasRef} className="native-overlay-canvas" aria-hidden="true" />
            {logoutCountdownOverlay ? (
                <div ref={logoutCountdownLabelRef} className="native-overlay-logout-countdown-label" aria-hidden="true">
                    {logoutCountdownOverlay.text}
                </div>
            ) : null}
        </>
    );
}

function parseCssPixelValue(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function setStylePixelValue(element: HTMLElement, property: 'left' | 'top' | 'width' | 'height', value: number): void {
    const next = `${value}px`;
    if (element.style[property] !== next) {
        element.style[property] = next;
    }
}

/** Positions the login title block to match {@link drawAppTitle} layout in SpriteUtils. */
function applyLoginTitleLayout(
    titleContainer: HTMLElement,
    titleMain: HTMLElement,
    titleSubtitle: HTMLElement,
    overlayLeft: number,
    overlayTop: number,
    contentWidth: number,
    contentHeight: number,
    scaleY: number,
): void {
    const titleFontSize = 56 * scaleY;
    const subtitleFontSize = 28 * scaleY;
    const padding = 30 * scaleY;
    const titleCenterY = contentHeight * 0.25;
    const subtitleCenterY = titleCenterY + 60 * scaleY;
    const stripeTop = titleCenterY - titleFontSize / 2 - padding;
    const stripeBottom = subtitleCenterY + subtitleFontSize / 2 + padding;
    const stripeHeight = stripeBottom - stripeTop;
    const titleGap = 60 * scaleY - titleFontSize / 2 - subtitleFontSize / 2;

    setStylePixelValue(titleContainer, 'left', overlayLeft);
    setStylePixelValue(titleContainer, 'top', overlayTop + stripeTop);
    setStylePixelValue(titleContainer, 'width', contentWidth);
    setStylePixelValue(titleContainer, 'height', stripeHeight);
    titleMain.style.fontSize = `${titleFontSize}px`;
    titleSubtitle.style.fontSize = `${subtitleFontSize}px`;
    titleContainer.style.gap = `${titleGap}px`;
}

function clearOverlay(context: CanvasRenderingContext2D, bounds: OverlayBounds): void {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, Math.ceil(bounds.width * bounds.dpr), Math.ceil(bounds.height * bounds.dpr));
}

function drawOverlay(
    context: CanvasRenderingContext2D,
    bounds: OverlayBounds,
    floatingTexts: ActiveFloatingText[],
    healthBar: NativeOverlayHealthBarPayload | undefined,
    logoutCountdown: NativeOverlayLogoutCountdownPayload | undefined,
    mapLoadingVisible: boolean,
    mapLoadingText: string,
    mapLoadingDrawLoggedRef: MutableRefObject<boolean>,
    timeMs: number,
): void {
    clearOverlay(context, bounds);
    if (bounds.width <= 0 || bounds.height <= 0) {
        return;
    }

    if (mapLoadingVisible) {
        if (!mapLoadingDrawLoggedRef.current) {
            console.info('[NativeOverlayCanvas] draw map loading overlay', {
                text: mapLoadingText,
                width: bounds.width,
                height: bounds.height,
                dpr: bounds.dpr,
                scaleX: bounds.scaleX,
                scaleY: bounds.scaleY,
            });
            mapLoadingDrawLoggedRef.current = true;
        }
        drawMapLoadingOverlay(context, bounds, mapLoadingText);
        return;
    }

    context.setTransform(
        bounds.dpr * bounds.scaleX,
        0,
        0,
        bounds.dpr * bounds.scaleY,
        bounds.dpr * bounds.contentOffsetX,
        bounds.dpr * bounds.contentOffsetY,
    );

    if (logoutCountdown) {
        drawLogoutCountdownStripe(context, bounds);
    }

    if (healthBar) {
        drawHealthBar(context, healthBar);
    }

    let floatingTextWriteIndex = 0;
    for (const floatingText of floatingTexts) {
        const elapsedMs = timeMs - floatingText.createdAtMs;
        if (elapsedMs >= floatingText.totalDurationMs) {
            continue;
        }

        drawFloatingText(context, floatingText, elapsedMs);
        floatingTexts[floatingTextWriteIndex] = floatingText;
        floatingTextWriteIndex++;
    }
    floatingTexts.length = floatingTextWriteIndex;
}

function getLogoutCountdownMetrics(bounds: OverlayBounds): { top: number; centerY: number; height: number } {
    const scaleY = bounds.scaleY || 1;
    const logicalHeight = bounds.height / scaleY;
    const shiftedTopMarginPx = 50;
    const extraVerticalPadPx = 30;
    const topMargin = (Math.min(22, Math.max(10, Math.round(logicalHeight * 0.02))) + shiftedTopMarginPx) * scaleY;
    const height = (Math.max(50, Math.round(logicalHeight * 0.07)) + extraVerticalPadPx * 2) * scaleY;
    return { top: topMargin, centerY: topMargin + height / 2, height };
}

function drawLogoutCountdownStripe(context: CanvasRenderingContext2D, bounds: OverlayBounds): void {
    const metrics = getLogoutCountdownMetrics(bounds);
    context.save();
    context.setTransform(bounds.dpr, 0, 0, bounds.dpr, 0, 0);
    context.globalAlpha = 1;
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(0, metrics.top, bounds.width, metrics.height);
    context.restore();
}

function drawMapLoadingOverlay(context: CanvasRenderingContext2D, bounds: OverlayBounds, text: string): void {
    const backingWidth = Math.ceil(bounds.width * bounds.dpr);
    const backingHeight = Math.ceil(bounds.height * bounds.dpr);
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, backingWidth, backingHeight);

    context.setTransform(bounds.dpr, 0, 0, bounds.dpr, 0, 0);
    const label = text.trim() || 'Loading map...';
    const fontSize = Math.max(20, Math.round(20 * Math.max(bounds.scaleX, bounds.scaleY)));
    context.font = `bold ${fontSize}px Georgia, serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#1a0f0a';
    context.shadowBlur = 2;
    context.shadowOffsetX = 1;
    context.shadowOffsetY = 1;
    context.strokeStyle = '#1a0f0a';
    context.lineWidth = Math.max(2, Math.round(fontSize * 0.1));
    context.fillStyle = '#f4e4c1';
    context.strokeText(label, bounds.width / 2, bounds.height / 2);
    context.fillText(label, bounds.width / 2, bounds.height / 2);
    context.restore();
}

function drawHealthBar(context: CanvasRenderingContext2D, bar: NativeOverlayHealthBarPayload): void {
    const left = Math.round(bar.centerX - bar.width / 2);
    const top = Math.round(bar.centerY - bar.height / 2);

    context.fillStyle = bar.trackColor;
    context.fillRect(left, top, bar.width, bar.height);

    const fillWidth = Math.max(0, bar.width * bar.hpRatio);
    context.fillStyle = bar.fillColor;
    context.fillRect(left, top, fillWidth, bar.height);

    context.strokeStyle = bar.borderColor;
    context.lineWidth = 1;
    context.strokeRect(left, top, bar.width, bar.height);
}

function drawFloatingText(context: CanvasRenderingContext2D, floatingText: ActiveFloatingText, elapsedMs: number): void {
    const screenPosition = worldToScreen(
        floatingText.scene,
        floatingText.x,
        floatingText.y - (elapsedMs / 1000) * floatingText.upwardTravelPxPerSec,
    );
    if (!screenPosition) {
        return;
    }

    const alpha = getFloatingTextAlpha(floatingText, elapsedMs);
    if (alpha <= 0) {
        return;
    }

    context.save();
    context.globalAlpha = alpha;
    context.font = buildFont(floatingText.fontSize, floatingText.bold, floatingText.fontFamily);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = floatingText.color;
    context.fillText(floatingText.text, screenPosition.x, screenPosition.y);
    context.restore();
}

function getFloatingTextAlpha(floatingText: ActiveFloatingText, elapsedMs: number): number {
    const fadeStartMs = floatingText.totalDurationMs - floatingText.fadeDurationMs;
    if (floatingText.fadeDurationMs <= 0 || elapsedMs < fadeStartMs) {
        return 1;
    }

    return Math.max(0, 1 - (elapsedMs - fadeStartMs) / floatingText.fadeDurationMs);
}

function worldToScreen(scene: Scene, worldX: number, worldY: number): { x: number; y: number } | undefined {
    if (!scene.cameras?.main) {
        return undefined;
    }

    const camera = scene.cameras.main;
    return {
        x: (worldX - camera.scrollX) * camera.zoom + camera.x,
        y: (worldY - camera.scrollY) * camera.zoom + camera.y,
    };
}

function buildFont(fontSize: number, bold: boolean, fontFamily: string): string {
    return `${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
}
