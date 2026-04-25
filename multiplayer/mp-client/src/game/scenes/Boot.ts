import { Scene } from 'phaser';
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
        setDebugModeEnabled(this, false);
        setDisplayLargeItemsEnabled(this, false);

        this.registry.set(LOADING_BG_KEY, 'loading-bg');
        this.registry.set(LOGIN_SCREEN_BG_KEY, 'login-screen-bg');

        this.scene.start('LoadingScreen');
    }
}
