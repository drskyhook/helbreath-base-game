using System.Diagnostics;
using System.Diagnostics.Tracing;
using System.Globalization;
using System.Runtime;
using System.Text;

namespace Server.Utils;

/// <summary>
/// Listens to runtime GC events for this process and writes one concise summary line per collection.
/// </summary>
public sealed class GarbageCollectorMonitor : EventListener, IDisposable {
    private const string DotNetRuntimeEventSourceName = "Microsoft-Windows-DotNETRuntime";
    private const EventKeywords DotNetRuntimeGcKeyword = (EventKeywords)0x1;

    private readonly object syncRoot = new();
    private readonly Dictionary<int, GcCollectionState> collectionsByNumber = new();
    private readonly StreamWriter writer;
    private int? lastEndedGcNumber;
    private bool disposed;
    private bool isReady;
    private long? pendingPauseStartTimestamp;

    /// <summary>Timestamp captured when this monitor was created and used in the log file name.</summary>
    public DateTimeOffset CreatedAt { get; }

    /// <summary>Absolute path to the event log created for this monitor instance.</summary>
    public string LogFilePath { get; }

    public GarbageCollectorMonitor() {
        CreatedAt = DateTimeOffset.Now;
        var timestamp = CreatedAt.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture);
        LogFilePath = Path.Combine(Directory.GetCurrentDirectory(), $"gc_logs_{timestamp}.txt");
        writer = new StreamWriter(
            new FileStream(LogFilePath, FileMode.CreateNew, FileAccess.Write, FileShare.Read),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)) {
            AutoFlush = true,
        };
        isReady = true;
        EnableRuntimeGcEvents();

        WriteLogLine("# timestamp | event | duration | stw | heap used | reclaimed");
        WriteLogLine($"# started {FormatTimestamp(CreatedAt)} | file={Path.GetFileName(LogFilePath)}");
        WriteLogLine(
            $"# gc mode | server={GCSettings.IsServerGC} | latency={GCSettings.LatencyMode} | pid={Environment.ProcessId} | runtime={Environment.Version}");
    }

    /// <summary>Stops listening, flushes any pending summaries, and closes the backing log file. Safe to call more than once.</summary>
    public new void Dispose() {
        lock (syncRoot) {
            if (disposed) {
                return;
            }

            foreach (var collection in collectionsByNumber.Values
                .OrderBy(collection => collection.StartedAtTimestamp)) {
                WriteSummaryLine(collection);
            }

            disposed = true;
            writer.Dispose();
        }

        base.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Enables informational GC runtime events when the CLR event source becomes available.</summary>
    protected override void OnEventSourceCreated(EventSource eventSource) {
        if (disposed || !isReady) {
            return;
        }

        TryEnableRuntimeGcEvents(eventSource);
    }

    /// <summary>Collects just the major GC lifecycle events and converts them into one compact summary line per collection.</summary>
    protected override void OnEventWritten(EventWrittenEventArgs eventData) {
        if (disposed || eventData.EventSource is null) {
            return;
        }

        try {
            switch (eventData.EventName) {
                case string eventName when IsSuspendBeginEvent(eventName):
                    HandleSuspendBegin();
                    break;
                case string eventName when IsGcStartEvent(eventName):
                    HandleGcStart(eventData);
                    break;
                case string eventName when IsGcEndEvent(eventName):
                    HandleGcEnd(eventData);
                    break;
                case string eventName when IsHeapStatsEvent(eventName):
                    HandleHeapStats(eventData);
                    break;
                case string eventName when IsRestartEndEvent(eventName):
                    HandleRestartEnd();
                    break;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine($"[GarbageCollectorMonitor] Error handling GC event '{eventData.EventName}': {ex}");
        }
    }

    private static bool IsGcStartEvent(string? eventName) {
        return eventName is not null &&
            eventName.StartsWith("GCStart", StringComparison.Ordinal);
    }

    private static bool IsGcEndEvent(string? eventName) {
        return eventName is not null &&
            (eventName.StartsWith("GCEnd", StringComparison.Ordinal) ||
                eventName.StartsWith("GCStop", StringComparison.Ordinal));
    }

    private static bool IsSuspendBeginEvent(string? eventName) {
        return eventName is not null &&
            eventName.StartsWith("GCSuspendEEBegin", StringComparison.Ordinal);
    }

    private static bool IsRestartEndEvent(string? eventName) {
        return eventName is not null &&
            eventName.StartsWith("GCRestartEEEnd", StringComparison.Ordinal);
    }

    private static bool IsHeapStatsEvent(string? eventName) {
        return eventName is not null &&
            eventName.StartsWith("GCHeapStats", StringComparison.Ordinal);
    }

    private static string FormatTimestamp(DateTimeOffset timestamp) {
        return timestamp.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
    }

    private static bool TryGetPayloadInt32(EventWrittenEventArgs eventData, string payloadName, out int value) {
        value = 0;
        if (eventData.Payload is null || eventData.PayloadNames is null) {
            return false;
        }

        for (var i = 0; i < eventData.PayloadNames.Count; i++) {
            if (!string.Equals(eventData.PayloadNames[i], payloadName, StringComparison.Ordinal)) {
                continue;
            }

            var payloadValue = eventData.Payload[i];
            switch (payloadValue) {
                case byte byteValue:
                    value = byteValue;
                    return true;
                case sbyte sbyteValue:
                    value = sbyteValue;
                    return true;
                case short shortValue:
                    value = shortValue;
                    return true;
                case ushort ushortValue:
                    value = ushortValue;
                    return true;
                case int intValue:
                    value = intValue;
                    return true;
                case uint uintValue when uintValue <= int.MaxValue:
                    value = (int)uintValue;
                    return true;
                case long longValue when longValue is >= int.MinValue and <= int.MaxValue:
                    value = (int)longValue;
                    return true;
                case ulong ulongValue when ulongValue <= int.MaxValue:
                    value = (int)ulongValue;
                    return true;
                case string stringValue when int.TryParse(stringValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedValue):
                    value = parsedValue;
                    return true;
            }
        }

        return false;
    }

    private static bool TryGetPayloadInt64(EventWrittenEventArgs eventData, string payloadName, out long value) {
        value = 0;
        if (eventData.Payload is null || eventData.PayloadNames is null) {
            return false;
        }

        for (var i = 0; i < eventData.PayloadNames.Count; i++) {
            if (!string.Equals(eventData.PayloadNames[i], payloadName, StringComparison.Ordinal)) {
                continue;
            }

            var payloadValue = eventData.Payload[i];
            switch (payloadValue) {
                case byte byteValue:
                    value = byteValue;
                    return true;
                case sbyte sbyteValue:
                    value = sbyteValue;
                    return true;
                case short shortValue:
                    value = shortValue;
                    return true;
                case ushort ushortValue:
                    value = ushortValue;
                    return true;
                case int intValue:
                    value = intValue;
                    return true;
                case uint uintValue:
                    value = uintValue;
                    return true;
                case long longValue:
                    value = longValue;
                    return true;
                case ulong ulongValue when ulongValue <= long.MaxValue:
                    value = (long)ulongValue;
                    return true;
                case string stringValue when long.TryParse(stringValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedValue):
                    value = parsedValue;
                    return true;
            }
        }

        return false;
    }

    private void EnableRuntimeGcEvents() {
        foreach (var eventSource in EventSource.GetSources()) {
            TryEnableRuntimeGcEvents(eventSource);
        }
    }

    private void TryEnableRuntimeGcEvents(EventSource eventSource) {
        if (string.Equals(eventSource.Name, DotNetRuntimeEventSourceName, StringComparison.Ordinal)) {
            EnableEvents(eventSource, EventLevel.Informational, DotNetRuntimeGcKeyword);
        }
    }

    private void HandleSuspendBegin() {
        lock (syncRoot) {
            pendingPauseStartTimestamp = Stopwatch.GetTimestamp();
        }
    }

    private void HandleGcStart(EventWrittenEventArgs eventData) {
        if (!TryGetPayloadInt32(eventData, "Count", out var gcNumber)) {
            return;
        }

        TryGetPayloadInt32(eventData, "Depth", out var generation);
        lock (syncRoot) {
            FlushCompletedCollectionsWithoutPause();

            collectionsByNumber[gcNumber] = new GcCollectionState(
                gcNumber,
                generation,
                Stopwatch.GetTimestamp(),
                DateTimeOffset.Now,
                GC.GetTotalMemory(false),
                pendingPauseStartTimestamp);
            pendingPauseStartTimestamp = null;
        }
    }

    private void HandleGcEnd(EventWrittenEventArgs eventData) {
        if (!TryGetPayloadInt32(eventData, "Count", out var gcNumber)) {
            return;
        }

        lock (syncRoot) {
            if (!collectionsByNumber.TryGetValue(gcNumber, out var collection)) {
                return;
            }

            collection.Duration = Stopwatch.GetElapsedTime(collection.StartedAtTimestamp);
            lastEndedGcNumber = gcNumber;
        }
    }

    private void HandleHeapStats(EventWrittenEventArgs eventData) {
        lock (syncRoot) {
            if (!TryGetHeapStatsTargetCollection(out var collection)) {
                return;
            }

            long heapUsedBytes = 0;
            foreach (var payloadName in HeapSizePayloadNames) {
                if (TryGetPayloadInt64(eventData, payloadName, out var generationSize)) {
                    heapUsedBytes += generationSize;
                }
            }

            collection.HeapUsedAfterBytes = heapUsedBytes > 0 ? heapUsedBytes : null;
        }
    }

    private void HandleRestartEnd() {
        lock (syncRoot) {
            if (!TryGetRestartTargetCollection(out var collection)) {
                return;
            }

            if (collection.PauseStartTimestamp.HasValue) {
                collection.PauseDuration = Stopwatch.GetElapsedTime(collection.PauseStartTimestamp.Value);
            }

            WriteSummaryLine(collection);
            collectionsByNumber.Remove(collection.GcNumber);
            if (lastEndedGcNumber == collection.GcNumber) {
                lastEndedGcNumber = null;
            }
        }
    }

    private bool TryGetHeapStatsTargetCollection(out GcCollectionState collection) {
        collection = null!;
        if (lastEndedGcNumber.HasValue &&
            collectionsByNumber.TryGetValue(lastEndedGcNumber.Value, out var endedCollection)) {
            collection = endedCollection;
            return true;
        }

        var candidate = collectionsByNumber.Values
            .Where(collection => collection.Duration.HasValue)
            .OrderByDescending(collection => collection.StartedAtTimestamp)
            .FirstOrDefault();
        if (candidate is null) {
            return false;
        }

        collection = candidate;
        return true;
    }

    private bool TryGetRestartTargetCollection(out GcCollectionState collection) {
        collection = null!;
        if (lastEndedGcNumber.HasValue &&
            collectionsByNumber.TryGetValue(lastEndedGcNumber.Value, out var endedCollection)) {
            collection = endedCollection;
            return true;
        }

        var candidate = collectionsByNumber.Values
            .OrderByDescending(collection => collection.StartedAtTimestamp)
            .FirstOrDefault();
        if (candidate is null) {
            return false;
        }

        collection = candidate;
        return true;
    }

    private void FlushCompletedCollectionsWithoutPause() {
        var completedCollections = collectionsByNumber.Values
            .Where(collection => collection.Duration.HasValue && collection.PauseDuration.HasValue)
            .OrderBy(collection => collection.StartedAtTimestamp)
            .ToArray();
        foreach (var collection in completedCollections) {
            WriteSummaryLine(collection);
            collectionsByNumber.Remove(collection.GcNumber);
            if (lastEndedGcNumber == collection.GcNumber) {
                lastEndedGcNumber = null;
            }
        }
    }

    private void WriteSummaryLine(GcCollectionState collection) {
        var durationText = collection.Duration.HasValue
            ? $"{collection.Duration.Value.TotalMilliseconds:F3} ms"
            : "n/a";
        var stwText = collection.PauseDuration.HasValue
            ? $"yes ({collection.PauseDuration.Value.TotalMilliseconds:F3} ms)"
            : "no";
        var heapUsedText = collection.HeapUsedAfterBytes.HasValue
            ? FormatMegabytes(collection.HeapUsedAfterBytes.Value)
            : "n/a";
        var reclaimedText = TryFormatReclaimedMegabytes(collection, out var reclaimedMegabytes)
            ? reclaimedMegabytes
            : "n/a";

        WriteLogLine(
            $"{FormatTimestamp(collection.StartedAt)} | GC Gen{collection.Generation} #{collection.GcNumber} | {durationText} | stw={stwText} | heap={heapUsedText} | reclaimed={reclaimedText}");
    }

    private static bool TryFormatReclaimedMegabytes(GcCollectionState collection, out string reclaimedMegabytes) {
        reclaimedMegabytes = string.Empty;
        if (!collection.HeapUsedAfterBytes.HasValue) {
            return false;
        }

        var reclaimedBytes = collection.ManagedBytesBefore - collection.HeapUsedAfterBytes.Value;
        if (reclaimedBytes < 0) {
            return false;
        }

        reclaimedMegabytes = FormatMegabytes(reclaimedBytes);
        return true;
    }

    private static string FormatMegabytes(long bytes) {
        return $"{bytes / (1024d * 1024d):F2} MB";
    }

    private void WriteLogLine(string message) {
        if (disposed) {
            return;
        }

        writer.WriteLine(message);
    }

    private static readonly string[] HeapSizePayloadNames = [
        "GenerationSize0",
        "GenerationSize1",
        "GenerationSize2",
        "GenerationSize3",
        "GenerationSize4",
    ];

    /// <summary>Tracks the major measurements for one GC cycle until enough data is available to write a summary line.</summary>
    private sealed class GcCollectionState {
        public GcCollectionState(int gcNumber, int generation, long startedAtTimestamp, DateTimeOffset startedAt, long managedBytesBefore, long? pauseStartTimestamp) {
            GcNumber = gcNumber;
            Generation = generation;
            StartedAtTimestamp = startedAtTimestamp;
            StartedAt = startedAt;
            ManagedBytesBefore = managedBytesBefore;
            PauseStartTimestamp = pauseStartTimestamp;
        }

        public int GcNumber { get; }
        public int Generation { get; }
        public long StartedAtTimestamp { get; }
        public DateTimeOffset StartedAt { get; }
        public long ManagedBytesBefore { get; }
        public long? PauseStartTimestamp { get; }
        public TimeSpan? Duration { get; set; }
        public TimeSpan? PauseDuration { get; set; }
        public long? HeapUsedAfterBytes { get; set; }
    }
}
