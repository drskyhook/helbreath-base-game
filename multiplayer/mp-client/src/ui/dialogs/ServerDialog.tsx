import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import { RpgSlider } from '../components/RpgSlider';
import { RpgHorizontalSeparator } from '../components/RpgHorizontalSeparator';
import { RpgCheckbox } from '../components/RpgCheckbox';
import { requestMakeServerCellOccupied, requestPlayerTeleportToCell, serverDialogStore, setIncomingLatency, setOutgoingLatency, setIncomingFluctuation, setOutgoingFluctuation, setGracePeriod, setSyncWithServer } from '../store/ServerDialog.store';
import { EventBus, type ToastRequestedEvent } from '../../game/EventBus';
import { TOAST_REQUESTED } from '../../constants/EventNames';

interface ServerDialogProps {
    position: { x: number; y: number };
    onClose: () => void;
    zIndex?: number;
    onBringToFront?: () => void;
}

export function ServerDialog({
    position,
    onClose,
    zIndex,
    onBringToFront,
}: ServerDialogProps) {
    const incomingLatency = useStore(serverDialogStore, (state) => state.incomingLatency);
    const outgoingLatency = useStore(serverDialogStore, (state) => state.outgoingLatency);
    const incomingFluctuation = useStore(serverDialogStore, (state) => state.incomingFluctuation);
    const outgoingFluctuation = useStore(serverDialogStore, (state) => state.outgoingFluctuation);
    const gracePeriod = useStore(serverDialogStore, (state) => state.gracePeriod);
    const syncWithServer = useStore(serverDialogStore, (state) => state.syncWithServer);

    const handleMakeServerCellOccupiedClick = () => {
        const toastEvent: ToastRequestedEvent = {
            message: 'Click on a cell you would like to occupy in the server side',
            severity: 'info',
        };

        EventBus.emit(TOAST_REQUESTED, toastEvent);
        requestMakeServerCellOccupied();
    };

    const handleTeleportToCellClick = () => {
        const toastEvent: ToastRequestedEvent = {
            message: 'Click on a cell you would like to teleport to',
            severity: 'info',
        };

        EventBus.emit(TOAST_REQUESTED, toastEvent);
        requestPlayerTeleportToCell();
    };

    return (
        <DraggableDialog
            title="Server"
            position={position}
            id="server-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div>
                <RpgButton onClick={handleTeleportToCellClick}>
                    Teleport to cell
                </RpgButton>

                <RpgButton onClick={handleMakeServerCellOccupiedClick} style={{ marginTop: '8px' }}>
                    Make server cell occupied
                </RpgButton>

                <RpgHorizontalSeparator />

                <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                    Incoming network delay
                    <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                        ({incomingLatency}ms)
                    </span>
                </div>
                <div className="rpg-zoom-container">
                    <RpgSlider
                        value={[incomingLatency]}
                        onValueChange={(value) => setIncomingLatency(value[0])}
                        min={0}
                        max={500}
                        step={1}
                    />
                </div>

                <RpgHorizontalSeparator />

                <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                    Outgoing network delay
                    <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                        ({outgoingLatency}ms)
                    </span>
                </div>
                <div className="rpg-zoom-container">
                    <RpgSlider
                        value={[outgoingLatency]}
                        onValueChange={(value) => setOutgoingLatency(value[0])}
                        min={0}
                        max={500}
                        step={1}
                    />
                </div>

                <RpgHorizontalSeparator />

                <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                    Movement animation grace period
                    <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                        ({gracePeriod}ms)
                    </span>
                </div>
                <div className="rpg-zoom-container">
                    <RpgSlider
                        value={[gracePeriod]}
                        onValueChange={(value) => setGracePeriod(value[0])}
                        min={0}
                        max={500}
                        step={1}
                    />
                </div>

                <RpgHorizontalSeparator />

                <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                    Incoming network fluctuation
                    <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                        ({incomingFluctuation}ms)
                    </span>
                </div>
                <div className="rpg-zoom-container">
                    <RpgSlider
                        value={[incomingFluctuation]}
                        onValueChange={(value) => setIncomingFluctuation(value[0])}
                        min={0}
                        max={500}
                        step={1}
                    />
                </div>

                <RpgHorizontalSeparator />

                <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                    Outgoing network fluctuation
                    <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                        ({outgoingFluctuation}ms)
                    </span>
                </div>
                <div className="rpg-zoom-container">
                    <RpgSlider
                        value={[outgoingFluctuation]}
                        onValueChange={(value) => setOutgoingFluctuation(value[0])}
                        min={0}
                        max={500}
                        step={1}
                    />
                </div>

                <RpgHorizontalSeparator />

                <div className="rpg-zoom-container" style={{ marginTop: '6px', marginBottom: '6px' }}>
                    <RpgCheckbox
                        id="sync-with-server-checkbox"
                        label="Sync with server"
                        checked={syncWithServer}
                        onCheckedChange={(checked) => setSyncWithServer(checked === true)}
                    />
                </div>
            </div>
        </DraggableDialog>
    );
}
