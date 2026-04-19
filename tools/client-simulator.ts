/// <reference types="node" />
/**
 * Client simulator for load-testing the game server.
 *
 * Usage (from `tools/` after `pnpm install`):
 *   pnpm run client-simulator -- [options]
 *   pnpm exec tsx client-simulator.ts [options]
 *
 * Generates protobuf into `multiplayer/mp-client/src/proto/generated` (same as mp-client `proto:generate`).
 *
 * Options (all optional):
 *   --ip=<string>           Server IP (default: localhost)
 *   --port=<number>         Server port (default: 1337)
 *   --clients=<number>      Number of simulated clients (default: 10)
 *   --rampUpTime=<number>   Seconds to spawn all clients (default: 10)
 *   --minInterval=<number>  Min ms between movement requests (default: 500)
 *   --maxInterval=<number>  Max ms between movement requests (default: 1000)
 * Examples:
 *   pnpm run client-simulator
 *   pnpm run client-simulator -- --clients=50
 *   pnpm run client-simulator -- --port=8080 --minInterval=300 --maxInterval=800
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    ClientMessage,
    ServerMessage,
    type InitialGameWorldState,
    type InitialState,
    type MonsterMoved,
    type MonstersEnteredRange,
    type MonstersLeftRange,
    type PingResponse,
    type PlayerMoved,
    type PlayersEnteredRange,
    type PlayersLeftRange,
    type PositionCorrected,
    type ResetPosition,
} from '../multiplayer/mp-client/src/proto/generated/network.ts';
import { applyItemDirectory } from '../multiplayer/mp-client/src/constants/Items';

const MIN_ALLOWED_INTERVAL_MS = 220;
const DEFAULT_MOVEMENT_SPEED_MS = 220;
const MAP_HEADER_SIZE = 256;
const MAP_BLOCKED_FLAG = 0x80;

interface SimulatorConfig {
    ip: string;
    port: number;
    clients: number;
    rampUpTimeSeconds: number;
    minIntervalMs: number;
    maxIntervalMs: number;
}

interface Position {
    x: number;
    y: number;
}

interface PendingMove {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}

interface ClientStats {
    movementRequests: number;
    pingRequests: number;
    positionCorrections: number;
    resetPositions: number;
    /** Count of `players_entered_range` messages received (bulk). */
    playersEnteredBatches: number;
    /** Count of `players_left_range` messages received (bulk). */
    playersLeftBatches: number;
    /** Count of `player_moved` for other players (visibility / pathfinding). */
    remotePlayerMoves: number;
    /** Count of `monster_moved` (updates local monster occupancy for pathfinding). */
    remoteMonsterMoves: number;
    /** Count of `monsters_entered_range` messages received (bulk). */
    monstersEnteredBatches: number;
    /** Count of `monsters_left_range` messages received (bulk). */
    monstersLeftBatches: number;
    /** Count of `player_movement_state_changed` from others (ignored for movement). */
    remoteMovementStateMessages: number;
}

interface ReportTotals extends ClientStats {
    requestsPerSecond: number;
    /** Mean of per-second `averagePingMs` samples (null if no snapshot ping data). */
    snapshotMeanAvgPingMs: number | null;
    /** P90 of per-second `p90PingMs` samples (null if no snapshot ping data). */
    snapshotP90PingMs: number | null;
    /** Largest per-second `maxPingMs` over the run (null if no snapshot ping data). */
    snapshotMaxPingMs: number | null;
}

interface ClientDisconnectInfo {
    clientIndex: number;
    wasConnected: boolean;
    wasInitialized: boolean;
}

interface SimulatedGameClientCallbacks {
    onUnexpectedDisconnect?: (info: ClientDisconnectInfo) => void;
}

interface SnapshotMetrics {
    elapsedSeconds: number;
    connectedClients: number;
    averagePingMs: number | null;
    p90PingMs: number | null;
    maxPingMs: number | null;
}

interface SimulationReportData {
    generatedAtUnixTime: number;
    runtimeMs: number;
    sustainedConnectedClients: number;
    endReason: string;
    settings: SimulatorConfig;
    totals: ReportTotals;
    snapshots: SnapshotMetrics[];
}

type SimulatorSignal = 'SIGINT' | 'SIGTERM';

class SimulatorMapTile {
    public readonly isMoveAllowed: boolean;
    public occupiedByGameObject = false;

    constructor(flags: number) {
        this.isMoveAllowed = (flags & MAP_BLOCKED_FLAG) === 0;
    }
}

class SimulatorMap {
    public readonly fileName: string;
    public sizeX = 0;
    public sizeY = 0;
    public tileSize = 0;
    public tiles: SimulatorMapTile[][] = [];

    constructor(fileName: string) {
        this.fileName = fileName;
    }

    public static async load(fileName: string): Promise<SimulatorMap> {
        const fileUrl = new URL(`../multiplayer/mp-client/public/assets/maps/${fileName}`, import.meta.url);
        const filePath = fileURLToPath(fileUrl);
        const bytes = await readFile(filePath);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const map = new SimulatorMap(fileName);
        map.parseMap(buffer);
        return map;
    }

    public getTile(x: number, y: number): SimulatorMapTile | undefined {
        if (y < 0 || y >= this.sizeY || x < 0 || x >= this.sizeX) {
            return undefined;
        }

        return this.tiles[y][x];
    }

    public setTileOccupied(x: number, y: number, occupied: boolean): void {
        const tile = this.getTile(x, y);
        if (tile) {
            tile.occupiedByGameObject = occupied;
        }
    }

    private parseMap(buffer: ArrayBuffer): void {
        const view = new Uint8Array(buffer);
        if (view.byteLength < MAP_HEADER_SIZE) {
            throw new Error(`Map ${this.fileName} is too small to contain a valid header.`);
        }

        let offset = 0;
        const headerBytes = view.slice(offset, offset + MAP_HEADER_SIZE);
        offset += MAP_HEADER_SIZE;

        const headerText = new TextDecoder('ascii').decode(headerBytes);
        this.parseHeader(headerText);

        if (this.sizeX <= 0 || this.sizeY <= 0 || this.tileSize <= 0) {
            throw new Error(`Invalid map dimensions for ${this.fileName}: ${this.sizeX}x${this.sizeY}, tileSize=${this.tileSize}`);
        }

        const expectedByteLength = MAP_HEADER_SIZE + (this.sizeX * this.sizeY * this.tileSize);
        if (view.byteLength < expectedByteLength) {
            throw new Error(`Map ${this.fileName} is truncated for dimensions ${this.sizeX}x${this.sizeY} and tileSize ${this.tileSize}.`);
        }

        this.tiles = [];

        for (let y = 0; y < this.sizeY; y++) {
            const row: SimulatorMapTile[] = [];
            for (let x = 0; x < this.sizeX; x++) {
                const flags = view[offset + 8];
                const tile = new SimulatorMapTile(flags);
                tile.occupiedByGameObject = !tile.isMoveAllowed;
                row.push(tile);
                offset += this.tileSize;
            }
            this.tiles.push(row);
        }
    }

    private parseHeader(headerText: string): void {
        const tokens = headerText.replace(/\0/g, ' ').split(/\s+/).filter((token) => token.length > 0);

        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            if (index + 2 >= tokens.length) {
                continue;
            }

            if (tokens[index + 1] !== '=') {
                continue;
            }

            const parsedValue = Number.parseInt(tokens[index + 2], 10);
            if (Number.isNaN(parsedValue)) {
                continue;
            }

            switch (token) {
                case 'MAPSIZEX':
                    this.sizeX = parsedValue;
                    break;
                case 'MAPSIZEY':
                    this.sizeY = parsedValue;
                    break;
                case 'TILESIZE':
                    this.tileSize = parsedValue;
                    break;
            }
        }
    }
}

const sharedMaps = new Map<string, Promise<SimulatorMap>>();

function getSharedMap(mapName: string): Promise<SimulatorMap> {
    const fileName = normalizeMapFileName(mapName);
    let sharedMap = sharedMaps.get(fileName);
    if (!sharedMap) {
        sharedMap = SimulatorMap.load(fileName);
        sharedMaps.set(fileName, sharedMap);
    }
    return sharedMap;
}

class SimulatedGameClient {
    private socket: WebSocket | undefined;
    private currentPosition: Position | undefined;
    private map: SimulatorMap | undefined;
    private playerId: string | undefined;
    /** Required on `RequestMovement` so the server accepts the packet (matches `GameWorld.IsRequestForCurrentWorld`). */
    private gameWorldId: string | undefined;
    private movementSpeedMs = DEFAULT_MOVEMENT_SPEED_MS;
    private runningMode = false;
    private isStopped = false;
    private isInitialized = false;
    private pendingMove: PendingMove | undefined;
    private movementTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingMoveTimer: ReturnType<typeof setTimeout> | undefined;
    private pingTimer: ReturnType<typeof setInterval> | undefined;
    private connectTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
    private pingSentAt: number | undefined;
    private latestPing: number | undefined;
    private pendingPingSequence: number | undefined;
    private isConnectionOpen = false;
    /** Last known grid cell per other player id (view radius); not written to shared map tiles. */
    private readonly remotePlayerCells = new Map<string, Position>();
    /** Last known grid cell per visible monster id; not written to shared map tiles. */
    private readonly remoteMonsterCells = new Map<string, Position>();
    private readonly stats: ClientStats = {
        movementRequests: 0,
        pingRequests: 0,
        positionCorrections: 0,
        resetPositions: 0,
        playersEnteredBatches: 0,
        playersLeftBatches: 0,
        remotePlayerMoves: 0,
        remoteMonsterMoves: 0,
        monstersEnteredBatches: 0,
        monstersLeftBatches: 0,
        remoteMovementStateMessages: 0,
    };
    private readonly readyPromise: Promise<void>;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;
    private pingSequence = 1;
    private readonly networkId = crypto.randomUUID();

    constructor(
        private readonly clientIndex: number,
        private readonly config: SimulatorConfig,
        private readonly callbacks: SimulatedGameClientCallbacks = {},
    ) {
        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
    }

    public async start(): Promise<void> {
        if (typeof WebSocket === 'undefined') {
            throw new Error('Global WebSocket is not available in this Node.js runtime.');
        }

        const websocketUrl = `ws://${this.config.ip}:${this.config.port}/ws`;
        const socket = new WebSocket(websocketUrl);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;

        this.connectTimeoutTimer = setTimeout(() => {
            this.connectTimeoutTimer = undefined;
            if (!this.isInitialized) {
                socket.close();
                this.rejectReady(new Error(`Client ${this.clientIndex} timed out waiting for initial game state.`));
            }
        }, 10000);

        socket.addEventListener('open', () => {
            this.isConnectionOpen = true;
            console.log(`[client ${this.clientIndex}] Connected to ${websocketUrl}`);
            this.sendAuthentication();
        }, { once: true });

        socket.addEventListener('message', (event) => {
            void this.handleMessage(event);
        });

        socket.addEventListener('close', () => {
            this.onClosed();
        });

        socket.addEventListener('error', () => {
            if (!this.isInitialized) {
                this.rejectReady(new Error(`Client ${this.clientIndex} failed to connect to ${websocketUrl}.`));
            }
        }, { once: true });

        await this.readyPromise;
    }

    public stop(): void {
        if (this.isStopped) {
            return;
        }

        this.isStopped = true;
        this.clearMovementTimer();
        this.clearPendingMoveTimer();
        this.clearPingInterval();
        this.remotePlayerCells.clear();
        this.remoteMonsterCells.clear();
        this.gameWorldId = undefined;

        if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
            this.socket.close();
        }

        if (!this.socket) {
            this.releaseOccupiedPosition();
        }
    }

    public getStats(): ClientStats {
        return { ...this.stats };
    }

    public getLatestPing(): number | undefined {
        return this.latestPing;
    }

    public isConnected(): boolean {
        return this.isConnectionOpen;
    }

    private async handleMessage(event: MessageEvent): Promise<void> {
        const bytes = await toUint8Array(event.data);
        if (!bytes) {
            return;
        }

        try {
            const message = ServerMessage.decode(bytes);
            switch (message.payload?.$case) {
                case 'initialState':
                    this.handleInitialState(message.payload.value);
                    break;
                case 'initialGameWorldState':
                    await this.handleInitialGameWorldState(message.payload.value);
                    break;
                case 'positionCorrected':
                    this.handlePositionCorrected(message.payload.value);
                    break;
                case 'resetPosition':
                    this.handleResetPosition(message.payload.value);
                    break;
                case 'pingResponse':
                    this.handlePingResponse(message.payload.value);
                    break;
                case 'playersEnteredRange':
                    this.handlePlayersEnteredRange(message.payload.value);
                    break;
                case 'playersLeftRange':
                    this.handlePlayersLeftRange(message.payload.value);
                    break;
                case 'playerMoved':
                    this.handlePlayerMoved(message.payload.value);
                    break;
                case 'monstersEnteredRange':
                    this.handleMonstersEnteredRange(message.payload.value);
                    break;
                case 'monstersLeftRange':
                    this.handleMonstersLeftRange(message.payload.value);
                    break;
                case 'monsterMoved':
                    this.handleMonsterMoved(message.payload.value);
                    break;
                case 'playerMovementStateChanged':
                    this.stats.remoteMovementStateMessages += 1;
                    break;
            }
        } catch (error) {
            console.warn(`[client ${this.clientIndex}] Failed to parse server message.`, error);
        }
    }

    private handleInitialState(data: InitialState): void {
        this.playerId = String(data.playerId);
        applyItemDirectory(data.itemsDirectory);
        this.movementSpeedMs = data.movementSpeedMs > 0 ? data.movementSpeedMs : DEFAULT_MOVEMENT_SPEED_MS;
        this.runningMode = data.runningMode;
    }

    private async handleInitialGameWorldState(data: InitialGameWorldState): Promise<void> {
        if (this.isInitialized) {
            return;
        }
        if (!this.playerId) {
            console.warn(`[client ${this.clientIndex}] InitialGameWorldState received before InitialState.`);
            return;
        }

        this.clearConnectTimeout();
        this.map = await getSharedMap(data.mapName);
        this.gameWorldId = data.gameWorldId;
        this.currentPosition = {
            x: data.playerX,
            y: data.playerY,
        };
        this.map.setTileOccupied(this.currentPosition.x, this.currentPosition.y, true);
        this.isInitialized = true;

        console.log(
            `[client ${this.clientIndex}] Ready on game world ${data.gameWorldId || '?'} (${normalizeMapFileName(data.mapName)}) ` +
            `at (${this.currentPosition.x}, ${this.currentPosition.y}) as player ${this.playerId} ` +
            `[speed=${this.movementSpeedMs}ms, running=${this.runningMode}]`,
        );

        this.startPingInterval();
        this.resolveReady();
        this.scheduleNextMovement();
    }

    private handlePositionCorrected(data: PositionCorrected): void {
        this.stats.positionCorrections += 1;
        this.pendingMove = undefined;
        this.clearPendingMoveTimer();
        this.applyAuthoritativePosition(data.destX, data.destY);
    }

    private handleResetPosition(data: ResetPosition): void {
        this.stats.resetPositions += 1;
        this.pendingMove = undefined;
        this.clearPendingMoveTimer();
        this.applyAuthoritativePosition(data.x, data.y);
    }

    private handlePingResponse(data: PingResponse): void {
        if (this.pingSentAt === undefined || this.pendingPingSequence !== data.sequence) {
            return;
        }

        this.latestPing = Math.round(performance.now() - this.pingSentAt);
        this.pendingPingSequence = undefined;
        this.pingSentAt = undefined;
    }

    private handlePlayersEnteredRange(data: PlayersEnteredRange): void {
        if (data.players.length === 0) {
            return;
        }
        this.stats.playersEnteredBatches += 1;
        for (const p of data.players) {
            const id = String(p.playerId);
            if (id === this.playerId) {
                continue;
            }
            this.remotePlayerCells.set(id, { x: p.x, y: p.y });
        }
    }

    private handlePlayersLeftRange(data: PlayersLeftRange): void {
        if (data.playerIds.length === 0) {
            return;
        }
        this.stats.playersLeftBatches += 1;
        for (const rawId of data.playerIds) {
            this.remotePlayerCells.delete(String(rawId));
        }
    }

    private handlePlayerMoved(data: PlayerMoved): void {
        const id = String(data.playerId);
        if (id === this.playerId) {
            return;
        }
        this.stats.remotePlayerMoves += 1;
        this.remotePlayerCells.set(id, { x: data.destX, y: data.destY });
    }

    private handleMonstersEnteredRange(data: MonstersEnteredRange): void {
        if (data.monsters.length === 0) {
            return;
        }
        this.stats.monstersEnteredBatches += 1;
        for (const m of data.monsters) {
            this.remoteMonsterCells.set(String(m.monsterId), { x: m.x, y: m.y });
        }
    }

    private handleMonstersLeftRange(data: MonstersLeftRange): void {
        if (data.monsterIds.length === 0) {
            return;
        }
        this.stats.monstersLeftBatches += 1;
        for (const rawId of data.monsterIds) {
            this.remoteMonsterCells.delete(String(rawId));
        }
    }

    private handleMonsterMoved(data: MonsterMoved): void {
        this.stats.remoteMonsterMoves += 1;
        this.remoteMonsterCells.set(String(data.monsterId), { x: data.destX, y: data.destY });
    }

    private applyAuthoritativePosition(nextX: number, nextY: number): void {
        if (!this.map || !this.currentPosition) {
            return;
        }

        this.map.setTileOccupied(this.currentPosition.x, this.currentPosition.y, false);
        this.currentPosition = { x: nextX, y: nextY };
        this.map.setTileOccupied(this.currentPosition.x, this.currentPosition.y, true);
    }

    private scheduleNextMovement(): void {
        if (this.isStopped || !this.isInitialized) {
            return;
        }

        const delayMs = randomIntInclusive(this.config.minIntervalMs, this.config.maxIntervalMs);
        this.movementTimer = setTimeout(() => {
            this.movementTimer = undefined;
            this.tryMove();
            this.scheduleNextMovement();
        }, delayMs);
    }

    private tryMove(): void {
        if (!this.map || !this.currentPosition || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        if (this.pendingMove) {
            return;
        }

        const freeAdjacentCells = findFreeAdjacentCells(
            this.map,
            this.currentPosition.x,
            this.currentPosition.y,
            this.remotePlayerCells,
            this.remoteMonsterCells,
        );
        if (freeAdjacentCells.length === 0) {
            return;
        }

        const nextCell = freeAdjacentCells[Math.floor(Math.random() * freeAdjacentCells.length)];
        const previousPosition = this.currentPosition;

        this.pendingMove = {
            fromX: previousPosition.x,
            fromY: previousPosition.y,
            toX: nextCell.x,
            toY: nextCell.y,
        };

        this.map.setTileOccupied(nextCell.x, nextCell.y, true);
        this.map.setTileOccupied(previousPosition.x, previousPosition.y, false);
        this.currentPosition = nextCell;
        this.stats.movementRequests += 1;

        this.pendingMoveTimer = setTimeout(() => {
            this.pendingMove = undefined;
            this.pendingMoveTimer = undefined;
        }, Math.max(this.movementSpeedMs, MIN_ALLOWED_INTERVAL_MS));

        const command = ClientMessage.encode({
            payload: {
                $case: 'requestMovement',
                value: {
                    curX: previousPosition.x,
                    curY: previousPosition.y,
                    destX: nextCell.x,
                    destY: nextCell.y,
                    gameWorldId: this.gameWorldId ?? '',
                },
            },
        }).finish();

        this.socket.send(command);
    }

    private sendAuthentication(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const command = ClientMessage.encode({
            payload: {
                $case: 'authenticateRequest',
                value: {
                    id: this.networkId,
                    characterName: `Bot ${this.clientIndex}`,
                },
            },
        }).finish();

        this.socket.send(command);
    }

    private startPingInterval(): void {
        this.clearPingInterval();
        this.sendPing();
        this.pingTimer = setInterval(() => {
            this.sendPing();
        }, 1000);
    }

    private sendPing(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.pingSentAt !== undefined) {
            return;
        }

        const sequence = this.pingSequence++;
        const command = ClientMessage.encode({
            payload: {
                $case: 'pingRequest',
                value: {
                    sequence,
                },
            },
        }).finish();

        this.pendingPingSequence = sequence;
        this.pingSentAt = performance.now();
        this.stats.pingRequests += 1;
        this.socket.send(command);
    }

    private onClosed(): void {
        const wasConnected = this.isConnectionOpen;
        const wasInitialized = this.isInitialized;

        this.clearConnectTimeout();
        this.clearMovementTimer();
        this.clearPendingMoveTimer();
        this.clearPingInterval();
        this.releaseOccupiedPosition();
        this.remotePlayerCells.clear();
        this.remoteMonsterCells.clear();
        this.gameWorldId = undefined;
        this.isConnectionOpen = false;
        this.latestPing = undefined;
        this.pendingPingSequence = undefined;
        this.pingSentAt = undefined;
        this.socket = undefined;

        if (!wasInitialized) {
            this.rejectReady(new Error(`Client ${this.clientIndex} disconnected before initialization completed.`));
        }

        if (!this.isStopped) {
            console.warn(`[client ${this.clientIndex}] Connection closed.`);
            this.callbacks.onUnexpectedDisconnect?.({
                clientIndex: this.clientIndex,
                wasConnected,
                wasInitialized,
            });
        }
    }

    private releaseOccupiedPosition(): void {
        if (this.map && this.currentPosition) {
            this.map.setTileOccupied(this.currentPosition.x, this.currentPosition.y, false);
        }

        this.currentPosition = undefined;
        this.pendingMove = undefined;
    }

    private clearConnectTimeout(): void {
        if (this.connectTimeoutTimer) {
            clearTimeout(this.connectTimeoutTimer);
            this.connectTimeoutTimer = undefined;
        }
    }

    private clearMovementTimer(): void {
        if (this.movementTimer) {
            clearTimeout(this.movementTimer);
            this.movementTimer = undefined;
        }
    }

    private clearPendingMoveTimer(): void {
        if (this.pendingMoveTimer) {
            clearTimeout(this.pendingMoveTimer);
            this.pendingMoveTimer = undefined;
        }
    }

    private clearPingInterval(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
    }
}

function normalizeMapFileName(mapName: string): string {
    return mapName.endsWith('.amd') ? mapName : `${mapName}.amd`;
}

function findFreeAdjacentCells(
    map: SimulatorMap,
    startX: number,
    startY: number,
    remotePlayers: ReadonlyMap<string, Position>,
    remoteMonsters: ReadonlyMap<string, Position>,
): Position[] {
    const freeCells: Position[] = [];
    const seenCells = new Set<string>();

    for (let x = startX - 1; x <= startX + 1; x++) {
        pushFreeCell(map, x, startY - 1, seenCells, freeCells, remotePlayers, remoteMonsters);
    }

    for (let y = startY; y <= startY + 1; y++) {
        pushFreeCell(map, startX + 1, y, seenCells, freeCells, remotePlayers, remoteMonsters);
    }

    for (let x = startX; x >= startX - 1; x--) {
        pushFreeCell(map, x, startY + 1, seenCells, freeCells, remotePlayers, remoteMonsters);
    }

    for (let y = startY; y >= startY; y--) {
        pushFreeCell(map, startX - 1, y, seenCells, freeCells, remotePlayers, remoteMonsters);
    }

    return freeCells;
}

function isCellOccupiedByRemoteMap(x: number, y: number, remoteOccupants: ReadonlyMap<string, Position>): boolean {
    for (const pos of remoteOccupants.values()) {
        if (pos.x === x && pos.y === y) {
            return true;
        }
    }
    return false;
}

function pushFreeCell(
    map: SimulatorMap,
    x: number,
    y: number,
    seenCells: Set<string>,
    freeCells: Position[],
    remotePlayers: ReadonlyMap<string, Position>,
    remoteMonsters: ReadonlyMap<string, Position>,
): void {
    const key = `${x},${y}`;
    if (seenCells.has(key)) {
        return;
    }

    seenCells.add(key);

    const tile = map.getTile(x, y);
    if (!tile || !tile.isMoveAllowed || tile.occupiedByGameObject) {
        return;
    }

    if (isCellOccupiedByRemoteMap(x, y, remotePlayers) || isCellOccupiedByRemoteMap(x, y, remoteMonsters)) {
        return;
    }

    freeCells.push({ x, y });
}

function parseArgs(argv: string[]): SimulatorConfig {
    const defaults: SimulatorConfig = {
        ip: 'localhost',
        port: 1337,
        clients: 10,
        rampUpTimeSeconds: 10,
        minIntervalMs: 500,
        maxIntervalMs: 1000,
    };

    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            continue;
        }

        const equalsIndex = token.indexOf('=');
        if (equalsIndex >= 0) {
            values.set(token.slice(2, equalsIndex), token.slice(equalsIndex + 1));
            continue;
        }

        const key = token.slice(2);
        const nextToken = argv[index + 1];
        if (!nextToken || nextToken.startsWith('--')) {
            values.set(key, 'true');
            continue;
        }

        values.set(key, nextToken);
        index += 1;
    }

    const config: SimulatorConfig = {
        ip: values.get('ip') ?? defaults.ip,
        port: parsePositiveInteger(values.get('port'), '--port', defaults.port),
        clients: parsePositiveInteger(values.get('clients'), '--clients', defaults.clients),
        rampUpTimeSeconds: parseNonNegativeNumber(values.get('rampUpTime'), '--rampUpTime', defaults.rampUpTimeSeconds),
        minIntervalMs: parsePositiveInteger(values.get('minInterval'), '--minInterval', defaults.minIntervalMs),
        maxIntervalMs: parsePositiveInteger(values.get('maxInterval'), '--maxInterval', defaults.maxIntervalMs),
    };

    if (config.minIntervalMs < MIN_ALLOWED_INTERVAL_MS) {
        throw new Error(`--minInterval must be at least ${MIN_ALLOWED_INTERVAL_MS}ms.`);
    }

    if (config.maxIntervalMs < config.minIntervalMs) {
        throw new Error('--maxInterval must be greater than or equal to --minInterval.');
    }

    return config;
}

function parsePositiveInteger(value: string | undefined, key: string, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
        throw new Error(`${key} must be a positive integer.`);
    }

    return parsedValue;
}

function parseNonNegativeNumber(value: string | undefined, key: string, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }

    const parsedValue = Number.parseFloat(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        throw new Error(`${key} must be a non-negative number.`);
    }

    return parsedValue;
}

function randomIntInclusive(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function toUint8Array(data: unknown): Promise<Uint8Array | undefined> {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }

    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    if (data instanceof Blob) {
        return new Uint8Array(await data.arrayBuffer());
    }

    if (typeof data === 'string') {
        return undefined;
    }

    return undefined;
}

async function delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

class StressTestController {
    private readonly clients: SimulatedGameClient[] = [];
    private readonly snapshots: SnapshotMetrics[] = [];
    private readonly startedAtMs = Date.now();
    private snapshotTimer: ReturnType<typeof setInterval> | undefined;
    private finalizing = false;

    constructor(private readonly config: SimulatorConfig) {
    }

    public addClient(client: SimulatedGameClient): void {
        this.clients.push(client);
    }

    public startMetricsCollection(): void {
        if (this.snapshotTimer) {
            return;
        }

        this.snapshotTimer = setInterval(() => {
            this.collectSnapshot();
        }, 1000);
    }

    public isFinalizing(): boolean {
        return this.finalizing;
    }

    public handleUnexpectedDisconnect(info: ClientDisconnectInfo): void {
        if (this.finalizing) {
            return;
        }

        const sustainedConnectedClients = this.getConnectedClientCount() + (info.wasConnected ? 1 : 0);
        const connectionState = info.wasInitialized ? 'after initialization' : 'before initialization completed';
        void this.finalize(
            `First disconnect observed on client ${info.clientIndex} ${connectionState}.`,
            sustainedConnectedClients,
        );
    }

    public handleSignal(signal: SimulatorSignal): void {
        if (this.finalizing) {
            return;
        }

        void this.finalize(`Stress test stopped by ${signal}.`, this.getConnectedClientCount());
    }

    public handleClientStartFailure(clientIndex: number, error: Error): void {
        if (this.finalizing) {
            return;
        }

        console.error(`[client ${clientIndex}] Failed to start.`, error);
        void this.finalize(`Client ${clientIndex} failed to start: ${error.message}`, this.getConnectedClientCount());
    }

    private collectSnapshot(): void {
        if (this.finalizing) {
            return;
        }

        const pingSamples = this.clients
            .filter((client) => client.isConnected())
            .map((client) => client.getLatestPing())
            .filter((ping): ping is number => ping !== undefined)
            .sort((left, right) => left - right);

        this.snapshots.push({
            elapsedSeconds: this.snapshots.length + 1,
            connectedClients: this.getConnectedClientCount(),
            averagePingMs: pingSamples.length > 0 ? roundMetric(calculateAverage(pingSamples)) : null,
            p90PingMs: pingSamples.length > 0 ? roundMetric(calculatePercentile(pingSamples, 0.9)) : null,
            maxPingMs: pingSamples.length > 0 ? pingSamples[pingSamples.length - 1] : null,
        });
    }

    private getConnectedClientCount(): number {
        return this.clients.reduce((count, client) => count + (client.isConnected() ? 1 : 0), 0);
    }

    private buildTotals(runtimeMs: number): ReportTotals {
        const totals = this.clients.reduce<ClientStats>((accumulator, client) => {
            const stats = client.getStats();
            accumulator.movementRequests += stats.movementRequests;
            accumulator.pingRequests += stats.pingRequests;
            accumulator.positionCorrections += stats.positionCorrections;
            accumulator.resetPositions += stats.resetPositions;
            accumulator.playersEnteredBatches += stats.playersEnteredBatches;
            accumulator.playersLeftBatches += stats.playersLeftBatches;
            accumulator.remotePlayerMoves += stats.remotePlayerMoves;
            accumulator.remoteMonsterMoves += stats.remoteMonsterMoves;
            accumulator.monstersEnteredBatches += stats.monstersEnteredBatches;
            accumulator.monstersLeftBatches += stats.monstersLeftBatches;
            accumulator.remoteMovementStateMessages += stats.remoteMovementStateMessages;
            return accumulator;
        }, {
            movementRequests: 0,
            pingRequests: 0,
            positionCorrections: 0,
            resetPositions: 0,
            playersEnteredBatches: 0,
            playersLeftBatches: 0,
            remotePlayerMoves: 0,
            remoteMonsterMoves: 0,
            monstersEnteredBatches: 0,
            monstersLeftBatches: 0,
            remoteMovementStateMessages: 0,
        });

        const runtimeSeconds = runtimeMs / 1000;
        const totalRequests = totals.movementRequests + totals.pingRequests;
        const pingRollup = computePingRollupFromSnapshots(this.snapshots);

        return {
            ...totals,
            requestsPerSecond: runtimeSeconds > 0 ? roundMetric(totalRequests / runtimeSeconds) : 0,
            snapshotMeanAvgPingMs: pingRollup.meanAvgPingMs,
            snapshotP90PingMs: pingRollup.p90OfP90sPingMs,
            snapshotMaxPingMs: pingRollup.peakMaxPingMs,
        };
    }

    private stopAllClients(): void {
        for (const client of this.clients) {
            client.stop();
        }
    }

    private async finalize(endReason: string, sustainedConnectedClients: number): Promise<void> {
        if (this.finalizing) {
            return;
        }

        this.finalizing = true;
        const endedAtMs = Date.now();

        if (this.snapshotTimer) {
            clearInterval(this.snapshotTimer);
            this.snapshotTimer = undefined;
        }

        this.stopAllClients();

        const runtimeMs = endedAtMs - this.startedAtMs;
        const totals = this.buildTotals(runtimeMs);
        const report: SimulationReportData = {
            generatedAtUnixTime: Math.floor(Date.now() / 1000),
            runtimeMs,
            sustainedConnectedClients,
            endReason,
            settings: this.config,
            totals,
            snapshots: this.snapshots,
        };

        const reportPath = resolve(process.cwd(), `report_${report.generatedAtUnixTime}.html`);
        await writeFile(reportPath, buildReportHtml(report), 'utf8');

        console.log(endReason);
        console.log(
            `Report written to ${reportPath}. sustainedConnectedClients=${report.sustainedConnectedClients}, ` +
            `runtime=${formatDuration(report.runtimeMs)}, movementRequests=${totals.movementRequests}, ` +
            `pingRequests=${totals.pingRequests}, requestsPerSecond=${totals.requestsPerSecond}, ` +
            `positionCorrections=${totals.positionCorrections}, resetPositions=${totals.resetPositions}, ` +
            `playersEnteredBatches=${totals.playersEnteredBatches}, playersLeftBatches=${totals.playersLeftBatches}, ` +
            `remotePlayerMoves=${totals.remotePlayerMoves}, remoteMonsterMoves=${totals.remoteMonsterMoves}, ` +
            `monstersEnteredBatches=${totals.monstersEnteredBatches}, monstersLeftBatches=${totals.monstersLeftBatches}, ` +
            `snapshotMeanAvgPingMs=${formatOptionalMetric(totals.snapshotMeanAvgPingMs)}, ` +
            `snapshotP90PingMs=${formatOptionalMetric(totals.snapshotP90PingMs)}, ` +
            `snapshotMaxPingMs=${formatOptionalMetric(totals.snapshotMaxPingMs)}`,
        );

        process.exit(0);
    }
}

function computePingRollupFromSnapshots(snapshots: SnapshotMetrics[]): {
    meanAvgPingMs: number | null;
    p90OfP90sPingMs: number | null;
    peakMaxPingMs: number | null;
} {
    const avgs = snapshots.map((s) => s.averagePingMs).filter((v): v is number => v !== null);
    const p90s = snapshots
        .map((s) => s.p90PingMs)
        .filter((v): v is number => v !== null)
        .sort((left, right) => left - right);
    const maxes = snapshots.map((s) => s.maxPingMs).filter((v): v is number => v !== null);

    return {
        meanAvgPingMs: avgs.length > 0 ? roundMetric(calculateAverage(avgs)) : null,
        p90OfP90sPingMs: p90s.length > 0 ? roundMetric(calculatePercentile(p90s, 0.9)) : null,
        peakMaxPingMs: maxes.length > 0 ? roundMetric(Math.max(...maxes)) : null,
    };
}

function formatOptionalMetric(value: number | null): string {
    return value === null ? 'n/a' : String(value);
}

function calculateAverage(values: number[]): number {
    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 1) {
        return sortedValues[0];
    }

    const index = Math.ceil(percentile * sortedValues.length) - 1;
    return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, index))];
}

function roundMetric(value: number): number {
    return Math.round(value * 100) / 100;
}

function formatDuration(durationMs: number): string {
    const totalSeconds = Math.floor(durationMs / 1000);
    const milliseconds = durationMs % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function formatSettings(config: SimulatorConfig): string {
    return [
        `ws://${config.ip}:${config.port}/ws`,
        `clients=${config.clients}`,
        `rampUpTime=${config.rampUpTimeSeconds}s`,
        `movementInterval=${config.minIntervalMs}-${config.maxIntervalMs}ms`,
    ].join(' | ');
}

function buildReportHtml(report: SimulationReportData): string {
    const serializedReport = JSON.stringify(report).replace(/</g, '\\u003c');
    const emptyState = report.snapshots.length === 0
        ? '<p class="empty-state">No 1-second snapshots were collected before the test ended.</p>'
        : '<div id="chart"></div>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stress Test Report</title>
    <style>
        :root {
            color-scheme: dark;
            --background: #0f172a;
            --panel: #111827;
            --panel-border: #1f2937;
            --text: #e5e7eb;
            --muted: #94a3b8;
            --grid: #334155;
            --avg: #22c55e;
            --p90: #3b82f6;
            --max: #ef4444;
            --line: #f8fafc;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 32px;
            font-family: Inter, Arial, sans-serif;
            background: var(--background);
            color: var(--text);
        }

        main {
            max-width: 1500px;
            margin: 0 auto;
        }

        h1, h2, p {
            margin: 0;
        }

        .summary {
            display: grid;
            gap: 16px;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            margin-top: 24px;
        }

        .card {
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: 16px;
            padding: 20px;
        }

        .label {
            color: var(--muted);
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .value {
            margin-top: 8px;
            font-size: 40px;
            font-weight: 700;
            line-height: 1.1;
        }

        .subvalue {
            margin-top: 8px;
            color: var(--muted);
            font-size: 15px;
        }

        .settings {
            margin-top: 12px;
            color: var(--text);
            font-size: 15px;
            line-height: 1.6;
            word-break: break-word;
        }

        .chart-panel {
            margin-top: 24px;
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: 16px;
            padding: 20px;
        }

        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .legend {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            color: var(--muted);
            font-size: 14px;
        }

        .legend-item {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .swatch {
            width: 12px;
            height: 12px;
            border-radius: 3px;
            display: inline-block;
        }

        .swatch.line {
            border-radius: 999px;
            height: 3px;
            margin-top: 4px;
        }

        svg {
            width: 100%;
            height: auto;
            display: block;
        }

        .empty-state {
            color: var(--muted);
            padding: 16px 0 8px;
        }
    </style>
</head>
<body>
    <main>
        <h1>Stress Test Report</h1>
        <p class="subvalue" style="margin-top: 8px;">${escapeHtml(report.endReason)}</p>

        <section class="summary">
            <article class="card">
                <p class="label">Sustained connected clients</p>
                <p class="value">${report.sustainedConnectedClients}</p>
                <p class="subvalue">Runtime ${escapeHtml(formatDuration(report.runtimeMs))}</p>
            </article>

            <article class="card">
                <p class="label">Simulator settings</p>
                <p class="settings">${escapeHtml(formatSettings(report.settings))}</p>
            </article>

            <article class="card">
                <p class="label">Totals</p>
                <p class="settings">movementRequests=${report.totals.movementRequests}<br />pingRequests=${report.totals.pingRequests}<br />requestsPerSecond=${report.totals.requestsPerSecond}<br />positionCorrections=${report.totals.positionCorrections}<br />resetPositions=${report.totals.resetPositions}<br />playersEnteredBatches=${report.totals.playersEnteredBatches}<br />playersLeftBatches=${report.totals.playersLeftBatches}<br />remotePlayerMoves=${report.totals.remotePlayerMoves}<br />remoteMonsterMoves=${report.totals.remoteMonsterMoves}<br />monstersEnteredBatches=${report.totals.monstersEnteredBatches}<br />monstersLeftBatches=${report.totals.monstersLeftBatches}<br />remoteMovementStateMessages=${report.totals.remoteMovementStateMessages}<br />snapshotMeanAvgPingMs=${escapeHtml(formatOptionalMetric(report.totals.snapshotMeanAvgPingMs))}<br />snapshotP90PingMs=${escapeHtml(formatOptionalMetric(report.totals.snapshotP90PingMs))}<br />snapshotMaxPingMs=${escapeHtml(formatOptionalMetric(report.totals.snapshotMaxPingMs))}</p>
            </article>
        </section>

        <section class="chart-panel">
            <div class="chart-header">
                <div>
                    <h2>Ping and Connected Clients by Second</h2>
                    <p class="subvalue">Bars show average, P90, and max ping for each 1-second snapshot. The white line shows total connected clients.</p>
                </div>
                <div class="legend">
                    <span class="legend-item"><span class="swatch" style="background: var(--avg);"></span>Average ping</span>
                    <span class="legend-item"><span class="swatch" style="background: var(--p90);"></span>P90 ping</span>
                    <span class="legend-item"><span class="swatch" style="background: var(--max);"></span>Max ping</span>
                    <span class="legend-item"><span class="swatch line" style="background: var(--line);"></span>Clients</span>
                </div>
            </div>
            ${emptyState}
        </section>
    </main>

    <script>
        const report = ${serializedReport};

        function renderChart() {
            if (!Array.isArray(report.snapshots) || report.snapshots.length === 0) {
                return;
            }

            const root = document.getElementById('chart');
            if (!root) {
                return;
            }

            const snapshots = report.snapshots;
            const width = 1400;
            const height = 640;
            const margin = { top: 48, right: 88, bottom: 76, left: 88 };
            const plotWidth = width - margin.left - margin.right;
            const plotHeight = height - margin.top - margin.bottom;
            const pingMax = Math.max(1, ...snapshots.map((snapshot) => snapshot.maxPingMs ?? 0));
            const connectedMax = Math.max(1, ...snapshots.map((snapshot) => snapshot.connectedClients));
            const xStep = plotWidth / snapshots.length;
            const groupWidth = Math.max(6, xStep * 0.72);
            const barWidth = Math.max(1, groupWidth / 3 - 2);
            const labelStep = Math.max(1, Math.ceil(snapshots.length / 18));
            const gridLines = 5;

            const toPingY = (value) => margin.top + plotHeight - (value / pingMax) * plotHeight;
            const toConnectedY = (value) => margin.top + plotHeight - (value / connectedMax) * plotHeight;
            const xCenter = (index) => margin.left + xStep * index + xStep / 2;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', \`0 0 \${width} \${height}\`);

            const append = (tag, attributes) => {
                const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
                for (const [key, value] of Object.entries(attributes)) {
                    element.setAttribute(key, String(value));
                }
                svg.appendChild(element);
                return element;
            };

            for (let index = 0; index <= gridLines; index++) {
                const ratio = index / gridLines;
                const y = margin.top + plotHeight - ratio * plotHeight;
                append('line', { x1: margin.left, y1: y, x2: margin.left + plotWidth, y2: y, stroke: '#334155', 'stroke-width': 1 });

                const pingValue = Math.round(pingMax * ratio);
                append('text', {
                    x: margin.left - 12,
                    y: y + 4,
                    fill: '#94a3b8',
                    'font-size': 12,
                    'text-anchor': 'end',
                }).textContent = String(pingValue);

                const connectedValue = Math.round(connectedMax * ratio);
                append('text', {
                    x: margin.left + plotWidth + 12,
                    y: y + 4,
                    fill: '#94a3b8',
                    'font-size': 12,
                    'text-anchor': 'start',
                }).textContent = String(connectedValue);
            }

            append('line', {
                x1: margin.left,
                y1: margin.top + plotHeight,
                x2: margin.left + plotWidth,
                y2: margin.top + plotHeight,
                stroke: '#cbd5e1',
                'stroke-width': 1.5,
            });

            append('line', {
                x1: margin.left,
                y1: margin.top,
                x2: margin.left,
                y2: margin.top + plotHeight,
                stroke: '#cbd5e1',
                'stroke-width': 1.5,
            });

            append('line', {
                x1: margin.left + plotWidth,
                y1: margin.top,
                x2: margin.left + plotWidth,
                y2: margin.top + plotHeight,
                stroke: '#cbd5e1',
                'stroke-width': 1.5,
            });

            append('text', {
                x: margin.left - 56,
                y: margin.top - 16,
                fill: '#e5e7eb',
                'font-size': 14,
                'font-weight': 600,
            }).textContent = 'Ping (ms)';

            append('text', {
                x: margin.left + plotWidth + 8,
                y: margin.top - 16,
                fill: '#e5e7eb',
                'font-size': 14,
                'font-weight': 600,
            }).textContent = 'Clients';

            append('text', {
                x: margin.left + plotWidth / 2,
                y: height - 20,
                fill: '#e5e7eb',
                'font-size': 14,
                'text-anchor': 'middle',
                'font-weight': 600,
            }).textContent = 'Time (seconds)';

            const linePoints = [];

            snapshots.forEach((snapshot, index) => {
                const centerX = xCenter(index);
                const leftX = centerX - groupWidth / 2;
                const bars = [
                    { value: snapshot.averagePingMs, color: '#22c55e' },
                    { value: snapshot.p90PingMs, color: '#3b82f6' },
                    { value: snapshot.maxPingMs, color: '#ef4444' },
                ];

                bars.forEach((bar, barIndex) => {
                    if (bar.value === null) {
                        return;
                    }

                    const barHeight = Math.max(1, margin.top + plotHeight - toPingY(bar.value));
                    append('rect', {
                        x: leftX + barIndex * (barWidth + 2),
                        y: toPingY(bar.value),
                        width: barWidth,
                        height: barHeight,
                        fill: bar.color,
                        rx: 2,
                    });
                });

                linePoints.push(\`\${centerX},\${toConnectedY(snapshot.connectedClients)}\`);
                append('circle', {
                    cx: centerX,
                    cy: toConnectedY(snapshot.connectedClients),
                    r: 3,
                    fill: '#f8fafc',
                });

                if ((index + 1) % labelStep === 0 || index === 0 || index === snapshots.length - 1) {
                    append('text', {
                        x: centerX,
                        y: margin.top + plotHeight + 24,
                        fill: '#94a3b8',
                        'font-size': 12,
                        'text-anchor': 'middle',
                    }).textContent = String(snapshot.elapsedSeconds);
                }
            });

            append('polyline', {
                points: linePoints.join(' '),
                fill: 'none',
                stroke: '#f8fafc',
                'stroke-width': 2.5,
                'stroke-linejoin': 'round',
                'stroke-linecap': 'round',
            });

            root.replaceChildren(svg);
        }

        renderChart();
    </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

async function main(): Promise<void> {
    const config = parseArgs(process.argv.slice(2));
    const controller = new StressTestController(config);
    process.once('SIGINT', () => {
        controller.handleSignal('SIGINT');
    });

    process.once('SIGTERM', () => {
        controller.handleSignal('SIGTERM');
    });

    console.log(
        `Starting simulator: ${config.clients} clients over ${config.rampUpTimeSeconds}s ` +
        `to ws://${config.ip}:${config.port}/ws with movement interval ${config.minIntervalMs}-${config.maxIntervalMs}ms.`,
    );

    const rampUpMs = config.rampUpTimeSeconds * 1000;
    const spawnStepMs = config.clients <= 1 ? 0 : rampUpMs / (config.clients - 1);
    controller.startMetricsCollection();

    for (let index = 0; index < config.clients; index++) {
        if (controller.isFinalizing()) {
            break;
        }

        const client = new SimulatedGameClient(index + 1, config, {
            onUnexpectedDisconnect: (info) => {
                controller.handleUnexpectedDisconnect(info);
            },
        });
        controller.addClient(client);

        const spawnDelay = Math.round(index * spawnStepMs);
        if (spawnDelay > 0) {
            await delay(spawnDelay - Math.round((index - 1) * spawnStepMs));
        }

        if (controller.isFinalizing()) {
            break;
        }

        client.start().catch((error) => {
            controller.handleClientStartFailure(index + 1, error instanceof Error ? error : new Error(String(error)));
        });
    }

}

main().catch((error) => {
    console.error('Client simulator failed.', error);
    process.exit(1);
});
