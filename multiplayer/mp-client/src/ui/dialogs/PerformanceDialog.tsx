import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { performanceDialogStore } from '../store/PerformanceDialog.store';

interface PerformanceDialogProps {
    position: { x: number; y: number };
    onClose: () => void;
    zIndex?: number;
    onBringToFront?: () => void;
}

export function PerformanceDialog({
    position,
    onClose,
    zIndex,
    onBringToFront,
}: PerformanceDialogProps) {
    const fps = useStore(performanceDialogStore, (state) => state.fps);
    const ping = useStore(performanceDialogStore, (state) => state.ping);
    const pingVariance = useStore(performanceDialogStore, (state) => state.pingVariance);
    const playersInMap = useStore(performanceDialogStore, (state) => state.playersInMap);
    const gameWorldQueueLength = useStore(performanceDialogStore, (state) => state.gameWorldQueueLength);

    return (
        <DraggableDialog
            title="Performance"
            position={position}
            id="performance-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div style={{ minWidth: '240px' }}>
                <div className="rpg-stats">
                    <div className="rpg-stat-item">
                        <span className="rpg-stat-label">FPS:</span>
                        <span className="rpg-stat-value">{fps}</span>
                    </div>
                    <div className="rpg-stat-item">
                        <span className="rpg-stat-label">Ping:</span>
                        <span className="rpg-stat-value">{ping !== undefined ? `${ping} ms` : 'N/A'}</span>
                    </div>
                    <div className="rpg-stat-item">
                        <span className="rpg-stat-label">Ping variance:</span>
                        <span className="rpg-stat-value">{pingVariance !== undefined ? `${Math.round(pingVariance)} ms` : 'N/A'}</span>
                    </div>
                    <div className="rpg-stat-item">
                        <span className="rpg-stat-label">Players in map:</span>
                        <span className="rpg-stat-value">{playersInMap !== undefined ? playersInMap : 'N/A'}</span>
                    </div>
                    <div className="rpg-stat-item">
                        <span className="rpg-stat-label">Game world queue:</span>
                        <span className="rpg-stat-value">{gameWorldQueueLength !== undefined ? gameWorldQueueLength : 'N/A'}</span>
                    </div>
                </div>
            </div>
        </DraggableDialog>
    );
}
