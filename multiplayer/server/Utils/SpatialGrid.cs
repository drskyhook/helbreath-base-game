using Server.World;
using Server.World.Game;

namespace Server.Utils;

/// <summary>
/// Player index sized to view radii: coarse cells reduce candidates, then Chebyshev bounds filter to the real neighborhood.
/// </summary>
public sealed class PlayersSpatialGrid {
    private readonly SpatialGrid<GameWorldPlayer> grid;
    private readonly int viewRadiusX;
    private readonly int viewRadiusY;

    public PlayersSpatialGrid(int viewRadiusX, int viewRadiusY) {
        if (viewRadiusX < 0) {
            throw new ArgumentOutOfRangeException(nameof(viewRadiusX), "View radius X must be non-negative.");
        }
        if (viewRadiusY < 0) {
            throw new ArgumentOutOfRangeException(nameof(viewRadiusY), "View radius Y must be non-negative.");
        }

        this.viewRadiusX = viewRadiusX;
        this.viewRadiusY = viewRadiusY;
        grid = new SpatialGrid<GameWorldPlayer>(
            Math.Max(1, viewRadiusX + 1),
            Math.Max(1, viewRadiusY + 1));
    }

    public int Count => grid.Count;

    public void Add(GameWorldPlayer item, int x, int y) {
        grid.Add(item, x, y);
    }

    public void Move(GameWorldPlayer item, int x, int y) {
        grid.Move(item, x, y);
    }

    public bool Remove(GameWorldPlayer item) {
        return grid.Remove(item);
    }

    /// <summary>Iterates players in the axis-aligned bounding box of the view diamond, excluding optional session.</summary>
    /// <param name="excludeDisconnected">When true (default), omits players without an active socket (e.g. grace-period ghosts still on the grid).</param>
    /// <remarks>Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.</remarks>
    public NearbyPlayersEnumerable GetNearbyPlayers(
        int centerX,
        int centerY,
        Guid? excludedSessionId = null,
        bool excludeDisconnected = true) {
        var minX = centerX - viewRadiusX;
        var maxX = centerX + viewRadiusX;
        var minY = centerY - viewRadiusY;
        var maxY = centerY + viewRadiusY;

        return new NearbyPlayersEnumerable(
            grid.QueryRectangle(minX, minY, maxX, maxY),
            centerX,
            centerY,
            viewRadiusX,
            viewRadiusY,
            excludedSessionId,
            excludeDisconnected);
    }

    /// <summary>Iterates players in the inclusive world-coordinate rectangle, excluding optional session.</summary>
    /// <remarks>Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.</remarks>
    public PlayersInRectangleEnumerable GetPlayersInRectangle(
        int minX,
        int minY,
        int maxX,
        int maxY,
        Guid? excludedSessionId = null,
        bool excludeDisconnected = true) {
        return new PlayersInRectangleEnumerable(
            grid.QueryRectangle(minX, minY, maxX, maxY),
            minX,
            minY,
            maxX,
            maxY,
            excludedSessionId,
            excludeDisconnected);
    }

    public readonly struct NearbyPlayersEnumerable {
        private readonly SpatialGrid<GameWorldPlayer>.RectangleEnumerable inner;
        private readonly int centerX;
        private readonly int centerY;
        private readonly int viewRadiusX;
        private readonly int viewRadiusY;
        private readonly Guid excludedSessionId;
        private readonly bool hasExcluded;
        private readonly bool excludeDisconnected;

        internal NearbyPlayersEnumerable(
            SpatialGrid<GameWorldPlayer>.RectangleEnumerable inner,
            int centerX,
            int centerY,
            int viewRadiusX,
            int viewRadiusY,
            Guid? excludedSessionId,
            bool excludeDisconnected) {
            this.inner = inner;
            this.centerX = centerX;
            this.centerY = centerY;
            this.viewRadiusX = viewRadiusX;
            this.viewRadiusY = viewRadiusY;
            this.excludedSessionId = excludedSessionId ?? Guid.Empty;
            hasExcluded = excludedSessionId.HasValue;
            this.excludeDisconnected = excludeDisconnected;
        }

        public NearbyPlayersEnumerator GetEnumerator() {
            return new NearbyPlayersEnumerator(
                inner.GetEnumerator(),
                centerX,
                centerY,
                viewRadiusX,
                viewRadiusY,
                excludedSessionId,
                hasExcluded,
                excludeDisconnected);
        }
    }

    public struct NearbyPlayersEnumerator {
        private SpatialGrid<GameWorldPlayer>.RectangleEnumerator inner;
        private readonly int centerX;
        private readonly int centerY;
        private readonly int viewRadiusX;
        private readonly int viewRadiusY;
        private readonly Guid excludedSessionId;
        private readonly bool hasExcluded;
        private readonly bool excludeDisconnected;
        private GameWorldPlayer? current;

        internal NearbyPlayersEnumerator(
            SpatialGrid<GameWorldPlayer>.RectangleEnumerator inner,
            int centerX,
            int centerY,
            int viewRadiusX,
            int viewRadiusY,
            Guid excludedSessionId,
            bool hasExcluded,
            bool excludeDisconnected) {
            this.inner = inner;
            this.centerX = centerX;
            this.centerY = centerY;
            this.viewRadiusX = viewRadiusX;
            this.viewRadiusY = viewRadiusY;
            this.excludedSessionId = excludedSessionId;
            this.hasExcluded = hasExcluded;
            this.excludeDisconnected = excludeDisconnected;
            current = null;
        }

        public GameWorldPlayer Current => current!;

        public bool MoveNext() {
            while (inner.MoveNext()) {
                var player = inner.Current;
                if (hasExcluded && player.SessionId == excludedSessionId) {
                    continue;
                }
                if (Math.Abs(player.PosX - centerX) > viewRadiusX || Math.Abs(player.PosY - centerY) > viewRadiusY) {
                    continue;
                }
                if (excludeDisconnected && player.Disconnected) {
                    continue;
                }
                current = player;
                return true;
            }
            current = null;
            return false;
        }
    }

    public readonly struct PlayersInRectangleEnumerable {
        private readonly SpatialGrid<GameWorldPlayer>.RectangleEnumerable inner;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;
        private readonly Guid excludedSessionId;
        private readonly bool hasExcluded;
        private readonly bool excludeDisconnected;

        internal PlayersInRectangleEnumerable(
            SpatialGrid<GameWorldPlayer>.RectangleEnumerable inner,
            int minX,
            int minY,
            int maxX,
            int maxY,
            Guid? excludedSessionId,
            bool excludeDisconnected) {
            this.inner = inner;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
            this.excludedSessionId = excludedSessionId ?? Guid.Empty;
            hasExcluded = excludedSessionId.HasValue;
            this.excludeDisconnected = excludeDisconnected;
        }

        public PlayersInRectangleEnumerator GetEnumerator() {
            return new PlayersInRectangleEnumerator(
                inner.GetEnumerator(),
                minX,
                minY,
                maxX,
                maxY,
                excludedSessionId,
                hasExcluded,
                excludeDisconnected);
        }
    }

    public struct PlayersInRectangleEnumerator {
        private SpatialGrid<GameWorldPlayer>.RectangleEnumerator inner;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;
        private readonly Guid excludedSessionId;
        private readonly bool hasExcluded;
        private readonly bool excludeDisconnected;
        private GameWorldPlayer? current;

        internal PlayersInRectangleEnumerator(
            SpatialGrid<GameWorldPlayer>.RectangleEnumerator inner,
            int minX,
            int minY,
            int maxX,
            int maxY,
            Guid excludedSessionId,
            bool hasExcluded,
            bool excludeDisconnected) {
            this.inner = inner;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
            this.excludedSessionId = excludedSessionId;
            this.hasExcluded = hasExcluded;
            this.excludeDisconnected = excludeDisconnected;
            current = null;
        }

        public GameWorldPlayer Current => current!;

        public bool MoveNext() {
            while (inner.MoveNext()) {
                var player = inner.Current;
                if (hasExcluded && player.SessionId == excludedSessionId) {
                    continue;
                }
                if (player.PosX < minX || player.PosX > maxX || player.PosY < minY || player.PosY > maxY) {
                    continue;
                }
                if (excludeDisconnected && player.Disconnected) {
                    continue;
                }
                current = player;
                return true;
            }
            current = null;
            return false;
        }
    }
}

/// <summary>
/// Monster index sized to view radii: coarse cells reduce candidates, then Chebyshev bounds filter to the real neighborhood.
/// </summary>
public sealed class MonstersSpatialGrid {
    private readonly SpatialGrid<GameWorldMonster> grid;
    private readonly int viewRadiusX;
    private readonly int viewRadiusY;

    public MonstersSpatialGrid(int viewRadiusX, int viewRadiusY) {
        if (viewRadiusX < 0) {
            throw new ArgumentOutOfRangeException(nameof(viewRadiusX), "View radius X must be non-negative.");
        }
        if (viewRadiusY < 0) {
            throw new ArgumentOutOfRangeException(nameof(viewRadiusY), "View radius Y must be non-negative.");
        }

        this.viewRadiusX = viewRadiusX;
        this.viewRadiusY = viewRadiusY;
        grid = new SpatialGrid<GameWorldMonster>(
            Math.Max(1, viewRadiusX + 1),
            Math.Max(1, viewRadiusY + 1));
    }

    public int Count => grid.Count;

    public void Add(GameWorldMonster item, int x, int y) {
        grid.Add(item, x, y);
    }

    public void Move(GameWorldMonster item, int x, int y) {
        grid.Move(item, x, y);
    }

    public bool Remove(GameWorldMonster item) {
        return grid.Remove(item);
    }

    /// <summary>Iterates monsters in the axis-aligned bounding box of the view diamond.</summary>
    /// <remarks>Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.</remarks>
    public NearbyMonstersEnumerable GetNearbyMonsters(int centerX, int centerY) {
        var minX = centerX - viewRadiusX;
        var maxX = centerX + viewRadiusX;
        var minY = centerY - viewRadiusY;
        var maxY = centerY + viewRadiusY;

        return new NearbyMonstersEnumerable(
            grid.QueryRectangle(minX, minY, maxX, maxY),
            centerX,
            centerY,
            viewRadiusX,
            viewRadiusY);
    }

    /// <summary>Iterates monsters in the inclusive world-coordinate rectangle.</summary>
    /// <remarks>Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.</remarks>
    public MonstersInRectangleEnumerable GetMonstersInRectangle(int minX, int minY, int maxX, int maxY) {
        return new MonstersInRectangleEnumerable(
            grid.QueryRectangle(minX, minY, maxX, maxY),
            minX,
            minY,
            maxX,
            maxY);
    }

    public readonly struct NearbyMonstersEnumerable {
        private readonly SpatialGrid<GameWorldMonster>.RectangleEnumerable inner;
        private readonly int centerX;
        private readonly int centerY;
        private readonly int viewRadiusX;
        private readonly int viewRadiusY;

        internal NearbyMonstersEnumerable(
            SpatialGrid<GameWorldMonster>.RectangleEnumerable inner,
            int centerX,
            int centerY,
            int viewRadiusX,
            int viewRadiusY) {
            this.inner = inner;
            this.centerX = centerX;
            this.centerY = centerY;
            this.viewRadiusX = viewRadiusX;
            this.viewRadiusY = viewRadiusY;
        }

        public NearbyMonstersEnumerator GetEnumerator() {
            return new NearbyMonstersEnumerator(inner.GetEnumerator(), centerX, centerY, viewRadiusX, viewRadiusY);
        }
    }

    public struct NearbyMonstersEnumerator {
        private SpatialGrid<GameWorldMonster>.RectangleEnumerator inner;
        private readonly int centerX;
        private readonly int centerY;
        private readonly int viewRadiusX;
        private readonly int viewRadiusY;
        private GameWorldMonster? current;

        internal NearbyMonstersEnumerator(
            SpatialGrid<GameWorldMonster>.RectangleEnumerator inner,
            int centerX,
            int centerY,
            int viewRadiusX,
            int viewRadiusY) {
            this.inner = inner;
            this.centerX = centerX;
            this.centerY = centerY;
            this.viewRadiusX = viewRadiusX;
            this.viewRadiusY = viewRadiusY;
            current = null;
        }

        public GameWorldMonster Current => current!;

        public bool MoveNext() {
            while (inner.MoveNext()) {
                var monster = inner.Current;
                if (Math.Abs(monster.PosX - centerX) > viewRadiusX || Math.Abs(monster.PosY - centerY) > viewRadiusY) {
                    continue;
                }
                current = monster;
                return true;
            }
            current = null;
            return false;
        }
    }

    public readonly struct MonstersInRectangleEnumerable {
        private readonly SpatialGrid<GameWorldMonster>.RectangleEnumerable inner;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;

        internal MonstersInRectangleEnumerable(
            SpatialGrid<GameWorldMonster>.RectangleEnumerable inner,
            int minX,
            int minY,
            int maxX,
            int maxY) {
            this.inner = inner;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
        }

        public MonstersInRectangleEnumerator GetEnumerator() {
            return new MonstersInRectangleEnumerator(inner.GetEnumerator(), minX, minY, maxX, maxY);
        }
    }

    public struct MonstersInRectangleEnumerator {
        private SpatialGrid<GameWorldMonster>.RectangleEnumerator inner;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;
        private GameWorldMonster? current;

        internal MonstersInRectangleEnumerator(
            SpatialGrid<GameWorldMonster>.RectangleEnumerator inner,
            int minX,
            int minY,
            int maxX,
            int maxY) {
            this.inner = inner;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
            current = null;
        }

        public GameWorldMonster Current => current!;

        public bool MoveNext() {
            while (inner.MoveNext()) {
                var monster = inner.Current;
                if (monster.PosX < minX || monster.PosX > maxX || monster.PosY < minY || monster.PosY > maxY) {
                    continue;
                }
                current = monster;
                return true;
            }
            current = null;
            return false;
        }
    }
}

/// <summary>
/// NPC index sized to view radii: coarse cells reduce candidates, then Chebyshev bounds filter to the real neighborhood.
/// </summary>
public sealed class NpcsSpatialGrid {
    private readonly SpatialGrid<GameWorldNPC> grid;
    private readonly int viewRadiusX;
    private readonly int viewRadiusY;

    public NpcsSpatialGrid(int viewRadiusX, int viewRadiusY) {
        if (viewRadiusX < 0) {
            throw new ArgumentOutOfRangeException(nameof(viewRadiusX), "View radius X must be non-negative.");
        }
        if (viewRadiusY < 0) {
            throw new ArgumentOutOfRangeException(nameof(viewRadiusY), "View radius Y must be non-negative.");
        }

        this.viewRadiusX = viewRadiusX;
        this.viewRadiusY = viewRadiusY;
        grid = new SpatialGrid<GameWorldNPC>(
            Math.Max(1, viewRadiusX + 1),
            Math.Max(1, viewRadiusY + 1));
    }

    public int Count => grid.Count;

    public void Add(GameWorldNPC item, int x, int y) {
        grid.Add(item, x, y);
    }

    public void Move(GameWorldNPC item, int x, int y) {
        grid.Move(item, x, y);
    }

    public bool Remove(GameWorldNPC item) {
        return grid.Remove(item);
    }

    /// <summary>Iterates NPCs in the axis-aligned bounding box of the view diamond.</summary>
    /// <remarks>Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.</remarks>
    public NearbyNpcsEnumerable GetNearbyNpcs(int centerX, int centerY) {
        var minX = centerX - viewRadiusX;
        var maxX = centerX + viewRadiusX;
        var minY = centerY - viewRadiusY;
        var maxY = centerY + viewRadiusY;

        return new NearbyNpcsEnumerable(
            grid.QueryRectangle(minX, minY, maxX, maxY),
            centerX,
            centerY,
            viewRadiusX,
            viewRadiusY);
    }

    /// <summary>Iterates NPCs in the inclusive world-coordinate rectangle.</summary>
    /// <remarks>Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.</remarks>
    public NpcsInRectangleEnumerable GetNpcsInRectangle(int minX, int minY, int maxX, int maxY) {
        return new NpcsInRectangleEnumerable(
            grid.QueryRectangle(minX, minY, maxX, maxY),
            minX,
            minY,
            maxX,
            maxY);
    }

    public readonly struct NearbyNpcsEnumerable {
        private readonly SpatialGrid<GameWorldNPC>.RectangleEnumerable inner;
        private readonly int centerX;
        private readonly int centerY;
        private readonly int viewRadiusX;
        private readonly int viewRadiusY;

        internal NearbyNpcsEnumerable(
            SpatialGrid<GameWorldNPC>.RectangleEnumerable inner,
            int centerX,
            int centerY,
            int viewRadiusX,
            int viewRadiusY) {
            this.inner = inner;
            this.centerX = centerX;
            this.centerY = centerY;
            this.viewRadiusX = viewRadiusX;
            this.viewRadiusY = viewRadiusY;
        }

        public NearbyNpcsEnumerator GetEnumerator() {
            return new NearbyNpcsEnumerator(inner.GetEnumerator(), centerX, centerY, viewRadiusX, viewRadiusY);
        }
    }

    public struct NearbyNpcsEnumerator {
        private SpatialGrid<GameWorldNPC>.RectangleEnumerator inner;
        private readonly int centerX;
        private readonly int centerY;
        private readonly int viewRadiusX;
        private readonly int viewRadiusY;
        private GameWorldNPC? current;

        internal NearbyNpcsEnumerator(
            SpatialGrid<GameWorldNPC>.RectangleEnumerator inner,
            int centerX,
            int centerY,
            int viewRadiusX,
            int viewRadiusY) {
            this.inner = inner;
            this.centerX = centerX;
            this.centerY = centerY;
            this.viewRadiusX = viewRadiusX;
            this.viewRadiusY = viewRadiusY;
            current = null;
        }

        public GameWorldNPC Current => current!;

        public bool MoveNext() {
            while (inner.MoveNext()) {
                var npc = inner.Current;
                if (Math.Abs(npc.PosX - centerX) > viewRadiusX || Math.Abs(npc.PosY - centerY) > viewRadiusY) {
                    continue;
                }
                current = npc;
                return true;
            }
            current = null;
            return false;
        }
    }

    public readonly struct NpcsInRectangleEnumerable {
        private readonly SpatialGrid<GameWorldNPC>.RectangleEnumerable inner;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;

        internal NpcsInRectangleEnumerable(
            SpatialGrid<GameWorldNPC>.RectangleEnumerable inner,
            int minX,
            int minY,
            int maxX,
            int maxY) {
            this.inner = inner;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
        }

        public NpcsInRectangleEnumerator GetEnumerator() {
            return new NpcsInRectangleEnumerator(inner.GetEnumerator(), minX, minY, maxX, maxY);
        }
    }

    public struct NpcsInRectangleEnumerator {
        private SpatialGrid<GameWorldNPC>.RectangleEnumerator inner;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;
        private GameWorldNPC? current;

        internal NpcsInRectangleEnumerator(
            SpatialGrid<GameWorldNPC>.RectangleEnumerator inner,
            int minX,
            int minY,
            int maxX,
            int maxY) {
            this.inner = inner;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
            current = null;
        }

        public GameWorldNPC Current => current!;

        public bool MoveNext() {
            while (inner.MoveNext()) {
                var npc = inner.Current;
                if (npc.PosX < minX || npc.PosX > maxX || npc.PosY < minY || npc.PosY > maxY) {
                    continue;
                }
                current = npc;
                return true;
            }
            current = null;
            return false;
        }
    }
}

/// <summary>Generic uniform grid: O(1) add/move/remove and rectangle queries over coarse cells for dynamic entities.</summary>
public sealed class SpatialGrid<T> where T : notnull {
    private readonly int cellWidth;
    private readonly int cellHeight;
    private readonly Dictionary<(int CellX, int CellY), HashSet<T>> itemsByCell = new();
    private readonly Dictionary<T, (int CellX, int CellY)> cellByItem = new();

    public SpatialGrid(int cellWidth, int cellHeight) {
        if (cellWidth <= 0) {
            throw new ArgumentOutOfRangeException(nameof(cellWidth), "Cell width must be greater than zero.");
        }
        if (cellHeight <= 0) {
            throw new ArgumentOutOfRangeException(nameof(cellHeight), "Cell height must be greater than zero.");
        }

        this.cellWidth = cellWidth;
        this.cellHeight = cellHeight;
    }

    public int Count => cellByItem.Count;

    public void Add(T item, int x, int y) {
        ArgumentNullException.ThrowIfNull(item);
        if (cellByItem.ContainsKey(item)) {
            throw new InvalidOperationException("Item is already tracked by the spatial grid.");
        }

        var cell = GetCell(x, y);
        GetOrCreateCellItems(cell).Add(item);
        cellByItem[item] = cell;
    }

    public void Move(T item, int x, int y) {
        ArgumentNullException.ThrowIfNull(item);
        if (!cellByItem.TryGetValue(item, out var previousCell)) {
            throw new InvalidOperationException("Item must be added to the spatial grid before it can move.");
        }

        var nextCell = GetCell(x, y);
        if (nextCell == previousCell) {
            return;
        }

        RemoveFromCell(previousCell, item);
        GetOrCreateCellItems(nextCell).Add(item);
        cellByItem[item] = nextCell;
    }

    public bool Remove(T item) {
        ArgumentNullException.ThrowIfNull(item);
        if (!cellByItem.TryGetValue(item, out var cell)) {
            return false;
        }

        RemoveFromCell(cell, item);
        cellByItem.Remove(item);
        return true;
    }

    /// <summary>
    /// Returns every item in cells overlapping the inclusive world-coordinate rectangle (callers filter precisely).
    /// Returns a struct enumerable so <c>foreach</c> does not allocate an iterator object on the heap.
    /// </summary>
    public RectangleEnumerable QueryRectangle(int minX, int minY, int maxX, int maxY) {
        return new RectangleEnumerable(this, minX, minY, maxX, maxY);
    }

    private (int CellX, int CellY) GetCell(int x, int y) {
        return (GetCellIndex(x, cellWidth), GetCellIndex(y, cellHeight));
    }

    private HashSet<T> GetOrCreateCellItems((int CellX, int CellY) cell) {
        if (!itemsByCell.TryGetValue(cell, out var items)) {
            items = new HashSet<T>();
            itemsByCell[cell] = items;
        }

        return items;
    }

    private void RemoveFromCell((int CellX, int CellY) cell, T item) {
        if (!itemsByCell.TryGetValue(cell, out var items)) {
            return;
        }

        items.Remove(item);
        if (items.Count == 0) {
            itemsByCell.Remove(cell);
        }
    }

    /// <summary>Floors world coordinates to cell indices with correct behavior for negative positions.</summary>
    private static int GetCellIndex(int value, int cellSize) {
        return value >= 0
            ? value / cellSize
            : ((value + 1) / cellSize) - 1;
    }

    public readonly struct RectangleEnumerable {
        private readonly SpatialGrid<T> grid;
        private readonly int minX;
        private readonly int minY;
        private readonly int maxX;
        private readonly int maxY;

        internal RectangleEnumerable(SpatialGrid<T> grid, int minX, int minY, int maxX, int maxY) {
            this.grid = grid;
            this.minX = minX;
            this.minY = minY;
            this.maxX = maxX;
            this.maxY = maxY;
        }

        public RectangleEnumerator GetEnumerator() {
            return new RectangleEnumerator(grid, minX, minY, maxX, maxY);
        }
    }

    /// <summary>
    /// Struct enumerator that walks every cell overlapping the query rectangle and yields each item.
    /// Stored HashSet&lt;T&gt;.Enumerator is itself a struct, so iteration is allocation-free.
    /// </summary>
    public struct RectangleEnumerator {
        private readonly SpatialGrid<T> grid;
        private readonly int minCellX;
        private readonly int maxCellX;
        private readonly int minCellY;
        private readonly int maxCellY;
        private int cellX;
        private int cellY;
        private HashSet<T>.Enumerator innerEnumerator;
        private bool hasInner;
        private T? current;

        internal RectangleEnumerator(SpatialGrid<T> grid, int minX, int minY, int maxX, int maxY) {
            this.grid = grid;

            if (minX > maxX || minY > maxY) {
                minCellX = 0;
                maxCellX = -1;
                minCellY = 0;
                maxCellY = -1;
            } else {
                minCellX = GetCellIndex(minX, grid.cellWidth);
                maxCellX = GetCellIndex(maxX, grid.cellWidth);
                minCellY = GetCellIndex(minY, grid.cellHeight);
                maxCellY = GetCellIndex(maxY, grid.cellHeight);
            }

            cellX = minCellX - 1;
            cellY = minCellY;
            innerEnumerator = default;
            hasInner = false;
            current = default;
        }

        public T Current => current!;

        public bool MoveNext() {
            while (true) {
                if (hasInner) {
                    if (innerEnumerator.MoveNext()) {
                        current = innerEnumerator.Current;
                        return true;
                    }

                    innerEnumerator.Dispose();
                    hasInner = false;
                }

                cellX++;
                if (cellX > maxCellX) {
                    cellX = minCellX;
                    cellY++;
                    if (cellY > maxCellY) {
                        current = default;
                        return false;
                    }
                }

                if (grid.itemsByCell.TryGetValue((cellX, cellY), out var items)) {
                    innerEnumerator = items.GetEnumerator();
                    hasInner = true;
                }
            }
        }
    }
}
