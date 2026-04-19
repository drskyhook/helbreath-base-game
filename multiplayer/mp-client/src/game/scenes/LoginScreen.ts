import { Scene } from 'phaser';
import { drawAppTitle } from '../../utils/SpriteUtils';
import { createGameStateManager, getGameStateManager, getInventoryManager, getLoginScreenBgKey, setInitialGameWorldState, setNetworkManager } from '../../utils/RegistryUtils';
import {
    CURRENT_SCENE_READY,
    INITIAL_GAME_WORLD_STATE_RECEIVED,
    IN_UI_CONNECT_TO_SERVER,
    OUT_UI_SET_SELECTED_MAP,
    SOCKET_DISCONNECTED,
} from '../../constants/EventNames';
import type { ConnectToServerPayload } from '../../constants/EventNames';
import { EventBus } from '../EventBus';
import { NetworkManager } from '../../utils/NetworkManager';
import type { InitialGameWorldStateEventData } from '../../Types';
import { setConnectingDialogOpen } from '../../ui/store/ConnectingDialog.store';
import { openConnectDialogForLogin, setConnectDialogOpen } from '../../ui/store/ConnectDialog.store';

/**
 * Login screen scene. Displays title and opens the Connect dialog to join the server.
 * Creates GameStateManager and transitions to GameWorld after a successful connection.
 */
export class LoginScreen extends Scene {
    private backgroundImage!: Phaser.GameObjects.Image;
    private isConnecting = false;
    private pendingInitialGameWorldStateListener: ((data: InitialGameWorldStateEventData) => void) | undefined;
    /** When set, login is waiting for initial state after TCP connect; auth failure closes the socket first. */
    private loginPendingDisconnectHandler: (() => void) | undefined;
    private connectToServerHandler: ((payload: ConnectToServerPayload) => void) | undefined;

    constructor() {
        super('LoginScreen');
    }

    public init() {
        this.clearPendingInitialGameWorldStateListener();
        this.clearLoginPendingDisconnectListener();
        this.clearConnectToServerListener();
        this.isConnecting = false;

        // Set black background as fallback before image loads
        this.cameras.main.setBackgroundColor(0x000000);

        // Get scene dimensions
        const width = this.scale.width;
        const height = this.scale.height;

        // Display background image immediately (loaded in Boot.ts)
        // Get login screen background image key from registry (loaded in Boot.ts)
        const loginBgKey = getLoginScreenBgKey(this);

        // Add background image immediately so it displays before cache fetching
        if (loginBgKey && this.textures.exists(loginBgKey)) {
            this.backgroundImage = this.add.image(width / 2, height / 2, loginBgKey);
            // Scale background to cover the entire scene
            const scaleX = width / this.backgroundImage.width;
            const scaleY = height / this.backgroundImage.height;
            const scale = Math.max(scaleX, scaleY);
            this.backgroundImage.setScale(scale);
            // Send background to back so button appears on top
            this.backgroundImage.setDepth(0);
        }

        createGameStateManager(this.game);

        this.events.once('shutdown', () => {
            this.clearPendingInitialGameWorldStateListener();
            this.clearLoginPendingDisconnectListener();
            this.clearConnectToServerListener();
            this.isConnecting = false;
            setConnectingDialogOpen(false);
            setConnectDialogOpen(false);
        });
    }

    public create() {
        // Draw application title and subtitle with black stripe background
        drawAppTitle(this);

        const gsm = getGameStateManager(this.game);
        openConnectDialogForLogin(gsm.getCharacterName() ?? '');

        const handleConnectToServer = async (payload: ConnectToServerPayload) => {
            if (this.isConnecting) {
                return;
            }

            this.isConnecting = true;
            this.clearPendingInitialGameWorldStateListener();
            setConnectingDialogOpen(true);

            // `connect()` resolves when the WebSocket opens; auth runs after that. If the server rejects
            // (e.g. duplicate session), the socket closes without initial state — recover the Connect UI.
            const handleSocketDisconnectedDuringLogin = () => {
                if (!this.pendingInitialGameWorldStateListener) {
                    return;
                }
                this.clearPendingInitialGameWorldStateListener();
                this.clearLoginPendingDisconnectListener();
                this.isConnecting = false;
                setConnectingDialogOpen(false);
                setConnectDialogOpen(true);
                setNetworkManager(this.game, undefined);
                console.warn('[LoginScreen] Connection closed before initial game world state (e.g. auth rejected).');
            };

            const handleInitialGameWorldStateReceived = (data: InitialGameWorldStateEventData) => {
                this.clearLoginPendingDisconnectListener();
                this.pendingInitialGameWorldStateListener = undefined;
                this.isConnecting = false;
                setConnectingDialogOpen(false);
                gsm.setCharacterName(payload.characterName);
                setInitialGameWorldState(this.game, {
                    gameWorldId: data.gameWorldId,
                    mapName: `${data.mapName}.amd`,
                    musicFile: data.musicFile || undefined,
                    playerX: data.playerX,
                    playerY: data.playerY,
                    playerId: data.playerId,
                    movementSpeedMs: data.movementSpeedMs,
                    runMode: data.runMode,
                    attackMode: data.attackMode,
                    teleportLocs: data.teleportLocs,
                    attackRangeCells: data.attackRangeCells,
                    attackDamage: data.attackDamage,
                    attackSpeedMs: data.attackSpeedMs,
                    attackStunDurationMs: data.attackStunDurationMs,
                    castSpeedMs: data.castSpeedMs,
                    arrowSpeedPxPerSec: data.arrowSpeedPxPerSec,
                    hp: data.hp,
                    maxHp: data.maxHp,
                    playerPickupAnimationTimeMs: data.playerPickupAnimationTimeMs,
                    playerBowAnimationDurationMs: data.playerBowAnimationDurationMs,
                    dead: data.dead,
                    playerDirection: data.playerDirection,
                    gender: data.gender,
                    skinColor: data.skinColor,
                    hairStyleIndex: data.hairStyleIndex,
                    underwearColorIndex: data.underwearColorIndex,
                    weather: data.weather,
                });
                if (data.gameWorldId) {
                    EventBus.emit(OUT_UI_SET_SELECTED_MAP, data.gameWorldId);
                }
                getInventoryManager(this.game);
                this.scene.start('GameWorld');
            };

            this.pendingInitialGameWorldStateListener = handleInitialGameWorldStateReceived;
            EventBus.once(INITIAL_GAME_WORLD_STATE_RECEIVED, handleInitialGameWorldStateReceived);

            const networkManager = new NetworkManager(gsm.getNetworkId());
            setNetworkManager(this.game, networkManager);

            try {
                await networkManager.connect(payload.host, payload.port, payload.characterName);
                this.loginPendingDisconnectHandler = handleSocketDisconnectedDuringLogin;
                EventBus.on(SOCKET_DISCONNECTED, handleSocketDisconnectedDuringLogin);
            } catch (error) {
                this.clearPendingInitialGameWorldStateListener();
                this.clearLoginPendingDisconnectListener();
                this.isConnecting = false;
                setConnectingDialogOpen(false);
                setConnectDialogOpen(true);
                console.error('[LoginScreen] Failed to connect to the server.', error);
                setNetworkManager(this.game, undefined);
            }
        };

        this.connectToServerHandler = handleConnectToServer;
        EventBus.on(IN_UI_CONNECT_TO_SERVER, handleConnectToServer);

        EventBus.emit(CURRENT_SCENE_READY, this);
    }

    private clearConnectToServerListener(): void {
        if (!this.connectToServerHandler) {
            return;
        }

        EventBus.off(IN_UI_CONNECT_TO_SERVER, this.connectToServerHandler);
        this.connectToServerHandler = undefined;
    }

    private clearPendingInitialGameWorldStateListener(): void {
        if (!this.pendingInitialGameWorldStateListener) {
            return;
        }

        EventBus.off(INITIAL_GAME_WORLD_STATE_RECEIVED, this.pendingInitialGameWorldStateListener);
        this.pendingInitialGameWorldStateListener = undefined;
    }

    private clearLoginPendingDisconnectListener(): void {
        if (!this.loginPendingDisconnectHandler) {
            return;
        }

        EventBus.off(SOCKET_DISCONNECTED, this.loginPendingDisconnectHandler);
        this.loginPendingDisconnectHandler = undefined;
    }
}
