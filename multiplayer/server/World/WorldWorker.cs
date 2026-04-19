using System.Collections.Concurrent;
using System.Diagnostics;

namespace Server.World;

/// <summary>
/// Dedicated thread that processes mailbox work for multiple worlds and advances their simulation ticks on a fixed interval.
/// </summary>
public sealed class WorldWorker : IDisposable {
    private readonly object worldsLock = new();
    private readonly List<IWorkerWorld> worlds = new();
    /// <summary>Copy of <see cref="worlds"/> for ticking outside the lock to avoid deadlocks with message handlers.</summary>
    private readonly List<IWorkerWorld> worldsTickScratch = new();
    /// <summary>Worlds with pending mailbox items waiting to run <see cref="IWorkerWorld.ProcessPendingMessages"/>.</summary>
    private readonly ConcurrentQueue<IWorkerWorld> readyWorlds = new();
    private readonly AutoResetEvent workSignal = new(false);
    private readonly CancellationTokenSource cancellationTokenSource = new();
    private readonly Thread thread;
    private readonly TimeSpan tickInterval;
    private bool started;
    private bool disposed;

    public WorldWorker(string name, TimeSpan tickInterval) {
        if (string.IsNullOrWhiteSpace(name)) {
            throw new ArgumentException("Worker name is required.", nameof(name));
        }
        if (tickInterval <= TimeSpan.Zero) {
            throw new ArgumentOutOfRangeException(nameof(tickInterval), "Tick interval must be greater than zero.");
        }

        Name = name;
        this.tickInterval = tickInterval;
        thread = new Thread(Run) {
            IsBackground = true,
            Name = name,
        };
    }

    public string Name { get; }
    public int ManagedThreadId => thread.ManagedThreadId;

    public void Start() {
        ThrowIfDisposed();
        if (started) {
            return;
        }

        started = true;
        thread.Start();
    }

    public void RegisterWorld(IWorkerWorld world) {
        ArgumentNullException.ThrowIfNull(world);
        ThrowIfDisposed();

        world.AttachToWorker(this);

        lock (worldsLock) {
            worlds.Add(world);
        }

        workSignal.Set();
    }

    public void Dispose() {
        if (disposed) {
            return;
        }

        disposed = true;
        cancellationTokenSource.Cancel();
        workSignal.Set();

        if (started && Thread.CurrentThread != thread) {
            thread.Join();
        }

        cancellationTokenSource.Dispose();
        workSignal.Dispose();
    }

    /// <summary>Enqueues the world for message processing if not already scheduled (coalesced wakeups).</summary>
    public void Schedule(IWorkerWorld world) {
        if (world.TryMarkScheduled()) {
            readyWorlds.Enqueue(world);
            workSignal.Set();
        }
    }

    /// <summary>Main loop: drain ready mailboxes, sleep until next tick or new work, then tick all attached worlds.</summary>
    private void Run() {
        var stopwatch = Stopwatch.StartNew();
        var previousTickAt = stopwatch.Elapsed;

        while (!cancellationTokenSource.IsCancellationRequested) {
            try {
                DrainReadyWorlds();
            } catch (Exception ex) {
                Console.Error.WriteLine($"[WorldWorker:{Name}] Error draining mailboxes: {ex}");
            }

            var now = stopwatch.Elapsed;
            var timeSincePreviousTick = now - previousTickAt;
            if (timeSincePreviousTick >= tickInterval) {
                previousTickAt = now;
                try {
                    TickWorlds(timeSincePreviousTick);
                } catch (Exception ex) {
                    Console.Error.WriteLine($"[WorldWorker:{Name}] Error ticking worlds: {ex}");
                }
                continue;
            }

            if (!readyWorlds.IsEmpty) {
                continue;
            }

            var waitTime = tickInterval - timeSincePreviousTick;
            if (waitTime < TimeSpan.Zero) {
                waitTime = TimeSpan.Zero;
            }

            workSignal.WaitOne(waitTime);
        }

        try {
            DrainReadyWorlds();
        } catch (Exception ex) {
            Console.Error.WriteLine($"[WorldWorker:{Name}] Error draining mailboxes on shutdown: {ex}");
        }
    }

    /// <summary>Processes all worlds currently signaled as having mailbox work.</summary>
    private void DrainReadyWorlds() {
        while (readyWorlds.TryDequeue(out var world)) {
            try {
                world.ProcessPendingMessages();
            } catch (Exception ex) {
                Console.Error.WriteLine($"[WorldWorker:{Name}] Error processing mailbox for a world: {ex}");
            }
        }
    }

    /// <summary>Invokes <see cref="GameWorld.Update"/> for every world registered on this worker.</summary>
    private void TickWorlds(TimeSpan deltaTime) {
        lock (worldsLock) {
            worldsTickScratch.Clear();
            worldsTickScratch.AddRange(worlds);
        }

        foreach (var world in worldsTickScratch) {
            if (!world.RequiresPeriodicUpdate) {
                continue;
            }

            try {
                world.Update(deltaTime);
            } catch (Exception ex) {
                Console.Error.WriteLine($"[WorldWorker:{Name}] Error during periodic update for a world: {ex}");
            }
        }
    }

    private void ThrowIfDisposed() {
        ObjectDisposedException.ThrowIf(disposed, this);
    }
}
