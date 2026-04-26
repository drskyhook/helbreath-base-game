import { Scene } from 'phaser';
import { PLAYER_ITEM_APPEARANCE_PENDING_TEXTURE } from '../../Config';
import { EventBus } from '../EventBus';
import { CURRENT_SCENE_READY } from '../../constants/EventNames';
import { LOADING_BG_KEY, LOGIN_SCREEN_BG_KEY } from '../../constants/RegistryKeys';
import { setDebugModeEnabled, setDisplayLargeItemsEnabled } from '../../utils/RegistryUtils';

/**
 * Initial Phaser scene. Loads loading/login backgrounds, sets registry flags (debug, displayLargeItems),
 * then starts LoadingScreen.
 */
export class Boot extends Scene {
    constructor() {
        super('Boot');
    }

    public preload() {
        this.load.setPath('assets');
        this.load.image('loading-bg', 'images/LoadingBg.jpg');
        this.load.image('login-screen-bg', 'images/LoginScreenBg.jpg');
    }

    public create() {
        // Initialize global debug mode
        setDebugModeEnabled(this, false);
        setDisplayLargeItemsEnabled(this, false);

        const pendingG = this.make.graphics({ x: 0, y: 0 });
        pendingG.fillStyle(0x000000, 0);
        pendingG.fillRect(0, 0, 1, 1);
        pendingG.generateTexture(PLAYER_ITEM_APPEARANCE_PENDING_TEXTURE, 1, 1);
        pendingG.destroy();

        this.registry.set(LOADING_BG_KEY, 'loading-bg');
        this.registry.set(LOGIN_SCREEN_BG_KEY, 'login-screen-bg');

        EventBus.emit(CURRENT_SCENE_READY, this);

        this.scene.start('LoadingScreen');
    }
}
