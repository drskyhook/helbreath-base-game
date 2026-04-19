namespace Server.World;

/// <summary>
/// Mailbox-driven unit of work hosted by a <see cref="WorldWorker"/>. Some worlds tick periodically, while others only run when messages arrive.
/// </summary>
public interface IWorkerWorld {
    /// <summary>Whether the worker should call <see cref="Update"/> during its periodic tick loop.</summary>
    bool RequiresPeriodicUpdate { get; }

    /// <summary>Attaches this world to the given worker exactly once.</summary>
    void AttachToWorker(WorldWorker worker);

    /// <summary>Marks the world as scheduled; returns true when the worker should enqueue it.</summary>
    bool TryMarkScheduled();

    /// <summary>Processes pending mailbox items on the worker thread.</summary>
    void ProcessPendingMessages();

    /// <summary>Runs the world's periodic update, if enabled.</summary>
    void Update(TimeSpan deltaTime);
}
