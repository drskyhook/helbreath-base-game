using Server.Utils;

namespace Server.Helpers;

/// <summary>Maintains a rolling buffer of ping interval deltas and exposes the maximum delta magnitude in the window for kick and movement tolerance.</summary>
public sealed class PlayerPingTracker {
    private readonly int sampleSize;
    /// <summary>Ring of |actualInterval - expectedInterval| samples in receive order until full.</summary>
    private RingBuffer<long> deltaSamples;
    /// <summary>Working copy of chronological samples when recomputing variance.</summary>
    private readonly long[] varianceScratch;
    private long lastPingTimeMs;
    /// <summary>Latest computed spread statistic (max of delta magnitudes in the sample window).</summary>
    private double pingVariance;

    public PlayerPingTracker(int sampleSize) {
        if (sampleSize <= 0) {
            throw new ArgumentOutOfRangeException(nameof(sampleSize), "Ping variance sample size must be greater than zero.");
        }
        this.sampleSize = sampleSize;
        deltaSamples = new RingBuffer<long>(sampleSize);
        varianceScratch = new long[sampleSize];
    }

    public double PingVariance => pingVariance;
    public long LastPingTimeMs => lastPingTimeMs;

    public void Reset() {
        lastPingTimeMs = 0;
        pingVariance = 0;
        deltaSamples = new RingBuffer<long>(sampleSize);
    }

    /// <summary>
    /// Returns the ping delta (|delta - pingIntervalMs|) and updates last ping time.
    /// Returns null on the first ping when no previous time exists.
    /// </summary>
    public long? RecordPingAndGetDelta(int pingIntervalMs) {
        var currentMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long? pingDelta = null;
        if (lastPingTimeMs > 0) {
            var delta = currentMs - lastPingTimeMs;
            pingDelta = Math.Abs(delta - pingIntervalMs);
            AddDeltaSample(pingDelta.Value);
        }
        lastPingTimeMs = currentMs;
        return pingDelta;
    }

    /// <summary>Updates <see cref="pingVariance"/> to the maximum delta magnitude among samples currently in the ring.</summary>
    private void AddDeltaSample(long pingDelta) {
        deltaSamples.Add(pingDelta, out _);
        if (deltaSamples.Count == 0) {
            pingVariance = 0;
            return;
        }

        var count = deltaSamples.CopyChronologicalSamples(varianceScratch.AsSpan());
        var max = varianceScratch[0];
        for (var i = 1; i < count; i++) {
            var v = varianceScratch[i];
            if (v > max) {
                max = v;
            }
        }
        pingVariance = max;
    }
}
