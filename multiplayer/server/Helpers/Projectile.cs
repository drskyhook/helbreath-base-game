namespace Server.Helpers;

/// <summary>Projectile travel-time helpers for combat and spell delays (grid-based Euclidean distance at 32 px per cell, or fixed pixel distance from config).</summary>
public static class Projectile {
    public static int ComputeTravelTime(int fromGridX, int fromGridY, int toGridX, int toGridY, int arrowSpeedPxPerSec) {
        const int tilePixels = 32;
        var dx = (toGridX - fromGridX) * (double)tilePixels;
        var dy = (toGridY - fromGridY) * (double)tilePixels;
        var distPx = Math.Sqrt(dx * dx + dy * dy);
        return (int)Math.Ceiling(distPx / arrowSpeedPxPerSec * 1000.0);
    }

    /// <summary>Milliseconds for a projectile to travel <paramref name="distancePx"/> at <paramref name="speedPxPerSec"/> (matches rectangle-AoE delay when distance is fixed in config).</summary>
    public static int ComputeTravelTimeFromPixelDistance(int distancePx, int speedPxPerSec) {
        return (int)Math.Ceiling(distancePx / (double)speedPxPerSec * 1000.0);
    }
}
