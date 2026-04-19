import { EventBus } from '../../game/EventBus';
import { OUT_UI_GAME_STATS_UPDATE } from '../../constants/EventNames';
import { createDialogStore } from './utils';

interface PerformanceDialogState {
    isOpen: boolean;
    fps: number;
    ping: number | undefined;
    pingVariance: number | undefined;
    playersInMap: number | undefined;
    gameWorldQueueLength: number | undefined;
}

const initialState: PerformanceDialogState = {
    isOpen: false,
    fps: 0,
    ping: undefined,
    pingVariance: undefined,
    playersInMap: undefined,
    gameWorldQueueLength: undefined,
};

const { store: performanceDialogStore, toggle: togglePerformanceDialog, setOpen: setPerformanceDialogOpen } =
    createDialogStore(initialState);

export { performanceDialogStore, togglePerformanceDialog, setPerformanceDialogOpen };

EventBus.on(OUT_UI_GAME_STATS_UPDATE, (stats: {
    fps: number;
    ping: number | undefined;
    pingVariance?: number;
    playersInMap?: number;
    gameWorldQueueLength?: number;
}) => {
    performanceDialogStore.setState((state) => ({
        ...state,
        fps: stats.fps,
        ping: stats.ping,
        pingVariance: stats.pingVariance,
        playersInMap: stats.playersInMap,
        gameWorldQueueLength: stats.gameWorldQueueLength,
    }));
});
