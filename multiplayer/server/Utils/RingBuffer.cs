namespace Server.Utils;

/// <summary>Fixed-capacity FIFO with overwrite-on-full semantics; used for ping delta history without allocations.</summary>
public sealed class RingBuffer<T> {
    private readonly T[] items;
    /// <summary>Index of the oldest item currently stored.</summary>
    private int oldestIndex;

    public RingBuffer(int capacity) {
        if (capacity <= 0) {
            throw new ArgumentOutOfRangeException(nameof(capacity), "Ring buffer capacity must be greater than zero.");
        }

        items = new T[capacity];
    }

    public int Count { get; private set; }
    public int Capacity => items.Length;
    public bool IsFull => Count == items.Length;

    public bool Add(T item, out T overwrittenItem) {
        overwrittenItem = default!;
        if (IsFull) {
            overwrittenItem = items[oldestIndex];
            items[oldestIndex] = item;
            oldestIndex = (oldestIndex + 1) % items.Length;
            return true;
        }

        items[(oldestIndex + Count) % items.Length] = item;
        Count++;
        return false;
    }

    /// <summary>Returns the newest item without removing it.</summary>
    public bool TryPeekNewest(out T item) {
        if (Count == 0) {
            item = default!;
            return false;
        }

        item = items[(oldestIndex + Count - 1) % items.Length];
        return true;
    }

    /// <summary>Removes and returns the newest item (LIFO) so the buffer can also back bounded stacks.</summary>
    public bool TryRemoveNewest(out T item) {
        if (Count == 0) {
            item = default!;
            return false;
        }

        var newestIndex = (oldestIndex + Count - 1) % items.Length;
        item = items[newestIndex];
        items[newestIndex] = default!;
        Count--;
        if (Count == 0) {
            oldestIndex = 0;
        }

        return true;
    }

    /// <summary>
    /// Copies samples in chronological order (oldest first). When the buffer is full, samples
    /// wrap in the backing array; this method unwraps them into oldest-to-newest order.
    /// </summary>
    public int CopyChronologicalSamples(Span<T> destination) {
        if (destination.Length < Count) {
            throw new ArgumentException($"Destination span must have length at least Count ({Count}).", nameof(destination));
        }
        if (Count == 0) {
            return 0;
        }

        for (var i = 0; i < Count; i++) {
            destination[i] = items[(oldestIndex + i) % items.Length]!;
        }
        return Count;
    }

    public T[] ToArray() {
        var result = new T[Count];
        if (Count == 0) {
            return result;
        }
        CopyChronologicalSamples(result.AsSpan());
        return result;
    }
}
