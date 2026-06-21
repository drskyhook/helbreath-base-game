import { Scene } from 'phaser';
import { drawVersionNumber } from '../../utils/SpriteUtils';
import { createGameStateManager, getInventoryManager } from '../../utils/RegistryUtils';
import { EventBus } from '../EventBus';
import {
    NATIVE_OVERLAY_LOGIN_BACKGROUND_HIDDEN,
    NATIVE_OVERLAY_LOGIN_BACKGROUND_SHOWN,
    NATIVE_OVERLAY_LOGIN_REQUESTED,
} from '../../constants/EventNames';
import { SPLASH_BACKGROUND_IMAGE_SRC } from '../../constants/SceneOverlays';

/**
 * Login screen scene. Version renders in Phaser; splash background, title, and Log in button use the native overlay.
 * Creates GameStateManager and transitions to GameWorld when the overlay button is clicked.
 */
export class LoginScreen extends Scene {
    private loginRequestedHandler?: () => void;

    constructor() {
        super('LoginScreen');
    }

    public init() {
        this.cameras.main.setBackgroundColor(0x000000);

        EventBus.emit(NATIVE_OVERLAY_LOGIN_BACKGROUND_SHOWN, { imageSrc: SPLASH_BACKGROUND_IMAGE_SRC });

        this.loginRequestedHandler = () => {
            getInventoryManager(this.game);
            this.scene.start('GameWorld');
        };
        EventBus.on(NATIVE_OVERLAY_LOGIN_REQUESTED, this.loginRequestedHandler);

        this.events.once('shutdown', () => {
            if (this.loginRequestedHandler) {
                EventBus.off(NATIVE_OVERLAY_LOGIN_REQUESTED, this.loginRequestedHandler);
                this.loginRequestedHandler = undefined;
            }
            EventBus.emit(NATIVE_OVERLAY_LOGIN_BACKGROUND_HIDDEN);
        });

        createGameStateManager(this.game);
    }

    public create() {
        drawVersionNumber(this);
    }
}
