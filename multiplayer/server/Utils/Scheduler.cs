namespace Server.Utils;

/// <summary>In-world timer queue (timeouts and intervals) advanced from <see cref="GameWorld"/> tick via <see cref="TriggerDueItems"/>.</summary>
public sealed class Scheduler {
    private readonly PriorityQueue<ScheduledItem, long> dueItems = new();
    /// <summary>Supports cancel/reschedule by stable id; stale queue entries are ignored via reference equality.</summary>
    private readonly Dictionary<int, ScheduledItem> itemsById = new();
    private int nextId = 1;

    public int SetTimeout(int milliseconds, Action callback) {
        return Schedule(milliseconds, callback, isInterval: false);
    }

    public int SetInterval(int milliseconds, Action callback) {
        return Schedule(milliseconds, callback, isInterval: true);
    }

    public void ClearTimeout(int timeoutId) {
        itemsById.Remove(timeoutId);
    }

    public void ClearInterval(int intervalId) {
        itemsById.Remove(intervalId);
    }

    /// <summary>Runs all callbacks whose due time is &lt;= now; re-queues intervals with updated deadlines.</summary>
    public void TriggerDueItems() {
        var nowMs = GetNowMilliseconds();
        while (dueItems.TryPeek(out var queuedItem, out var dueAtMs) && dueAtMs <= nowMs) {
            dueItems.Dequeue();

            if (!itemsById.TryGetValue(queuedItem.Id, out var activeItem) || !ReferenceEquals(activeItem, queuedItem)) {
                continue;
            }

            try {
                queuedItem.Callback();
            } catch (Exception ex) {
                Console.WriteLine($"[Scheduler] Error executing scheduled callback {queuedItem.Id}: {ex}");
            }

            if (!queuedItem.IsInterval) {
                itemsById.Remove(queuedItem.Id);
                continue;
            }

            if (!itemsById.TryGetValue(queuedItem.Id, out var currentItem) || !ReferenceEquals(currentItem, queuedItem)) {
                continue;
            }

            queuedItem.DueAtMilliseconds += queuedItem.IntervalMilliseconds;
            dueItems.Enqueue(queuedItem, queuedItem.DueAtMilliseconds);
        }
    }

    /// <summary>Registers a one-shot or repeating job; intervals must have positive period.</summary>
    private int Schedule(int milliseconds, Action callback, bool isInterval) {
        if (milliseconds < 0) {
            throw new ArgumentOutOfRangeException(nameof(milliseconds), "Delay must be zero or greater.");
        }
        if (isInterval && milliseconds == 0) {
            throw new ArgumentOutOfRangeException(nameof(milliseconds), "Interval must be greater than zero.");
        }

        ArgumentNullException.ThrowIfNull(callback);

        var id = nextId++;
        var item = new ScheduledItem(
            id,
            GetNowMilliseconds() + milliseconds,
            milliseconds,
            isInterval,
            callback);

        itemsById[id] = item;
        dueItems.Enqueue(item, item.DueAtMilliseconds);
        return id;
    }

    private static long GetNowMilliseconds() {
        return Environment.TickCount64;
    }

    private sealed class ScheduledItem {
        public ScheduledItem(int id, long dueAtMilliseconds, int intervalMilliseconds, bool isInterval, Action callback) {
            Id = id;
            DueAtMilliseconds = dueAtMilliseconds;
            IntervalMilliseconds = intervalMilliseconds;
            IsInterval = isInterval;
            Callback = callback;
        }

        public int Id { get; }
        public long DueAtMilliseconds { get; set; }
        public int IntervalMilliseconds { get; }
        public bool IsInterval { get; }
        public Action Callback { get; }
    }
}
