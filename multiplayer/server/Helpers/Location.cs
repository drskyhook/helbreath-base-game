using System.Diagnostics;

namespace Server.Helpers;

/// <summary>Grid geometry helpers shared by movement, spawning, and visibility (Chebyshev distance, neighbor search, and step facing).</summary>
public static class Location {
    /// <summary>
    /// Calculates the Chebyshev distance between two points in world coordinates.
    /// Uses Chebyshev distance (max of absolute differences in x and y), which is appropriate
    /// for diagonal movement in grid-based games.
    /// </summary>
    public static int GetDistance(int x1, int y1, int x2, int y2) {
        var dx = Math.Abs(x1 - x2);
        var dy = Math.Abs(y1 - y2);
        return Math.Max(dx, dy);
    }

    /// <summary>Expanding square rings from <paramref name="startX"/>,<paramref name="startY"/> until <paramref name="isFree"/> succeeds or radius exhausts.</summary>
    public static (int X, int Y)? FindNearestFreeLocation(Func<int, int, bool> isFree, int startX, int startY, int maxRadius = 50) {
        ArgumentNullException.ThrowIfNull(isFree);
        if (maxRadius < 0) {
            throw new ArgumentOutOfRangeException(nameof(maxRadius), "Max radius must be zero or greater.");
        }

        if (isFree(startX, startY)) {
            return (startX, startY);
        }

        for (var radius = 1; radius <= maxRadius; radius++) {
            for (var x = startX - radius; x <= startX + radius; x++) {
                var y = startY - radius;
                if (isFree(x, y)) {
                    return (x, y);
                }
            }

            for (var y = startY - radius + 1; y <= startY + radius; y++) {
                var x = startX + radius;
                if (isFree(x, y)) {
                    return (x, y);
                }
            }

            for (var x = startX + radius - 1; x >= startX - radius; x--) {
                var y = startY + radius;
                if (isFree(x, y)) {
                    return (x, y);
                }
            }

            for (var y = startY + radius - 1; y >= startY - radius + 1; y--) {
                var x = startX - radius;
                if (isFree(x, y)) {
                    return (x, y);
                }
            }
        }

        return null;
    }

    /// <summary>Two diagonal-adjacent candidates used for course correction when the primary dest cell is blocked.</summary>
    /// <exception cref="ArgumentException">Thrown when <paramref name="destX"/>,<paramref name="destY"/> equals the current cell (no step direction).</exception>
    public static (int LeftX, int LeftY, int RightX, int RightY) GetAdjacentCellsAt45DegreeOffset(int curX, int curY, int destX, int destY) {
        if (destX == curX && destY == curY) {
            throw new ArgumentException("Destination must differ from the current cell.", nameof(destX));
        }

        var dx = Math.Sign(destX - curX);
        var dy = Math.Sign(destY - curY);
        int leftX, leftY, rightX, rightY;
        switch ((dx, dy)) {
            case (1, 0):   // East
                leftX = curX + 1; leftY = curY - 1; rightX = curX + 1; rightY = curY + 1;
                break;
            case (-1, 0):  // West
                leftX = curX - 1; leftY = curY + 1; rightX = curX - 1; rightY = curY - 1;
                break;
            case (0, 1):   // South
                leftX = curX - 1; leftY = curY + 1; rightX = curX + 1; rightY = curY + 1;
                break;
            case (0, -1):  // North
                leftX = curX + 1; leftY = curY - 1; rightX = curX - 1; rightY = curY - 1;
                break;
            case (1, -1):   // NorthEast
                leftX = curX; leftY = curY - 1; rightX = curX + 1; rightY = curY;
                break;
            case (1, 1):    // SouthEast
                leftX = curX + 1; leftY = curY; rightX = curX; rightY = curY + 1;
                break;
            case (-1, 1):   // SouthWest
                leftX = curX; leftY = curY + 1; rightX = curX - 1; rightY = curY;
                break;
            case (-1, -1):  // NorthWest
                leftX = curX - 1; leftY = curY; rightX = curX; rightY = curY - 1;
                break;
            default:
                throw new UnreachableException($"Unexpected step direction ({dx}, {dy}).");
        }
        return (leftX, leftY, rightX, rightY);
    }

    /// <summary>One-step grid facing from <paramref name="sourceX"/>,<paramref name="sourceY"/> toward <paramref name="destinationX"/>,<paramref name="destinationY"/>; matches client <c>getNextDirection</c> in CoordinateUtils. Returns 0–7 or -1 if same cell.</summary>
    public static int GetNextGridDirection(int sourceX, int sourceY, int destinationX, int destinationY) {
        var x = sourceX - destinationX;
        var y = sourceY - destinationY;

        if (x == 0 && y == 0) {
            return -1;
        }

        if (x == 0) {
            if (y > 0) {
                return 0;
            }
            if (y < 0) {
                return 4;
            }
        }
        if (y == 0) {
            if (x > 0) {
                return 6;
            }
            if (x < 0) {
                return 2;
            }
        }
        if (x > 0 && y > 0) {
            return 7;
        }
        if (x < 0 && y > 0) {
            return 1;
        }
        if (x > 0 && y < 0) {
            return 5;
        }
        if (x < 0 && y < 0) {
            return 3;
        }

        return -1;
    }

    /// <summary>Grid delta for a facing value 0–7 from <see cref="GetNextGridDirection"/>; matches client <c>getDirectionOffset</c>.</summary>
    public static void GetDirectionDelta(int direction, out int dx, out int dy) {
        switch (direction) {
            case 0: dx = 0; dy = -1; break;  // North
            case 1: dx = 1; dy = -1; break;  // NorthEast
            case 2: dx = 1; dy = 0; break;   // East
            case 3: dx = 1; dy = 1; break;   // SouthEast
            case 4: dx = 0; dy = 1; break;   // South
            case 5: dx = -1; dy = 1; break;  // SouthWest
            case 6: dx = -1; dy = 0; break;  // West
            case 7: dx = -1; dy = -1; break; // NorthWest
            default:
                dx = 0;
                dy = 0;
                break;
        }
    }

    /// <summary>One Chebyshev step from <paramref name="curX"/>,<paramref name="curY"/> toward <paramref name="targetX"/>,<paramref name="targetY"/> (not necessarily free).</summary>
    public static bool TryGetNeighborToward(int curX, int curY, int targetX, int targetY, out int nextX, out int nextY) {
        var dir = GetNextGridDirection(curX, curY, targetX, targetY);
        if (dir < 0 || dir > 7) {
            nextX = curX;
            nextY = curY;
            return false;
        }

        GetDirectionDelta(dir, out var dx, out var dy);
        nextX = curX + dx;
        nextY = curY + dy;
        return true;
    }
}
