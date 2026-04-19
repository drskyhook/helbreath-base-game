namespace Server.Utils;

/// <summary>
/// Tracks which cells are occupied and which are free for a given game world.
/// Uses map-blocked cells as initially occupied; supports runtime setOccupied/setFree for entities.
/// Single-thread access only.
/// </summary>
public sealed class GameWorldOccupancyTracker {
    private readonly int sizeX;
    private readonly int sizeY;
    /// <summary>Row-major <c>occupiedCells[y * sizeX + x]</c>; true means blocked or standing player.</summary>
    private readonly bool[] occupiedCells;
    /// <summary>Row-major teleport flags used to avoid spawning directly onto transfer trigger cells.</summary>
    private readonly bool[] teleportCells;
    /// <summary>Count of true entries for diagnostics.</summary>
    private int occupiedCount;

    public GameWorldOccupancyTracker(
        int sizeX,
        int sizeY,
        IEnumerable<(int X, int Y)> initiallyOccupied,
        IEnumerable<(int X, int Y)>? teleportCells = null) {
        if (sizeX <= 0 || sizeY <= 0) {
            throw new ArgumentOutOfRangeException(nameof(sizeX), "Map dimensions must be greater than zero.");
        }

        this.sizeX = sizeX;
        this.sizeY = sizeY;
        occupiedCells = new bool[sizeX * sizeY];
        this.teleportCells = new bool[sizeX * sizeY];

        foreach (var cell in initiallyOccupied) {
            if (TryGetIndex(cell.X, cell.Y, out var index) && !occupiedCells[index]) {
                occupiedCells[index] = true;
                occupiedCount++;
            }
        }

        if (teleportCells is null) {
            return;
        }

        foreach (var cell in teleportCells) {
            if (TryGetIndex(cell.X, cell.Y, out var index)) {
                this.teleportCells[index] = true;
            }
        }
    }

    public int SizeX => sizeX;
    public int SizeY => sizeY;
    public int OccupiedCount => occupiedCount;

    public void SetOccupied(int x, int y) {
        if (TryGetIndex(x, y, out var index) && !occupiedCells[index]) {
            occupiedCells[index] = true;
            occupiedCount++;
        }
    }

    public void SetFree(int x, int y) {
        if (TryGetIndex(x, y, out var index) && occupiedCells[index]) {
            occupiedCells[index] = false;
            occupiedCount--;
        }
    }

    public bool IsFree(int x, int y) {
        return TryGetIndex(x, y, out var index) && !occupiedCells[index];
    }

    public bool IsFreeAndNotTeleportCell(int x, int y) {
        return TryGetIndex(x, y, out var index) && !occupiedCells[index] && !teleportCells[index];
    }

    private bool TryGetIndex(int x, int y, out int index) {
        if ((uint)x >= (uint)sizeX || (uint)y >= (uint)sizeY) {
            index = -1;
            return false;
        }

        index = (y * sizeX) + x;
        return true;
    }
}
