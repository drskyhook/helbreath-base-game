using System.Threading.Channels;
using Mmorpg.Network;
using Server.Utils;
using Server.World;
using Server.World.Game;

namespace Server.World.Global;

/// <summary>
/// Singleton cross-world actor for global features such as chat. It owns only mailbox-driven state and does not run a periodic simulation tick.
/// </summary>
public sealed class GlobalWorld : IWorkerWorld {
    private readonly Channel<GlobalWorldMessage> incomingMessages;
    private readonly Dictionary<Guid, GlobalWorldPlayer> playersBySessionId = new();
    private readonly int maxMessagesPerDispatch;
    private readonly int chatMessageMaxLength;
    private readonly string id;
    private WorldWorker? worker;
    private int isScheduled;

    public GlobalWorld(string id, SettingsConfig settings) {
        ArgumentNullException.ThrowIfNull(settings);
        if (string.IsNullOrWhiteSpace(id)) {
            throw new ArgumentException("Global world id is required.", nameof(id));
        }

        this.id = id;
        maxMessagesPerDispatch = settings.GameWorld.IncomingMessagesBatchSizePerDispatch;
        chatMessageMaxLength = settings.ChatMessageMaxLength;
        incomingMessages = Channel.CreateBounded<GlobalWorldMessage>(new BoundedChannelOptions(settings.GameWorld.IncomingMessagesQueueSize) {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait,
        });
    }

    public int ConnectedPlayerCount => playersBySessionId.Count;
    public int WorkerThreadId => worker?.ManagedThreadId ?? throw new InvalidOperationException($"Global world '{id}' is not yet attached to a worker.");
    public bool RequiresPeriodicUpdate => false;

    /// <summary>Posts a message to the global mailbox and wakes the worker if needed.</summary>
    public ValueTask EnqueueAsync(GlobalWorldMessage message, CancellationToken cancellationToken = default) {
        ArgumentNullException.ThrowIfNull(message);
        if (worker is null) {
            throw new InvalidOperationException($"Global world '{id}' must be registered to a worker before it can receive messages.");
        }

        if (incomingMessages.Writer.TryWrite(message)) {
            worker.Schedule(this);
            return ValueTask.CompletedTask;
        }

        return EnqueueSlowAsync(message, cancellationToken);
    }

    public void AttachToWorker(WorldWorker value) {
        ArgumentNullException.ThrowIfNull(value);
        if (worker is not null) {
            throw new InvalidOperationException($"Global world '{id}' is already attached to worker '{worker.Name}'.");
        }

        worker = value;
    }

    public bool TryMarkScheduled() {
        return Interlocked.Exchange(ref isScheduled, 1) == 0;
    }

    public void ProcessPendingMessages() {
        Volatile.Write(ref isScheduled, 0);

        var processedMessages = 0;
        while (processedMessages < maxMessagesPerDispatch &&
               incomingMessages.Reader.TryRead(out var message)) {
            HandleMessage(message);
            processedMessages++;
        }

        if (incomingMessages.Reader.TryPeek(out _)) {
            worker!.Schedule(this);
        }
    }

    public void Update(TimeSpan _) {
    }

    private async ValueTask EnqueueSlowAsync(GlobalWorldMessage message, CancellationToken cancellationToken) {
        await incomingMessages.Writer.WriteAsync(message, cancellationToken);
        worker!.Schedule(this);
    }

    /// <summary>Dispatches one mailbox item; logs and continues on handler exceptions.</summary>
    private void HandleMessage(GlobalWorldMessage message) {
        try {
            switch (message) {
                case GlobalPlayerConnectedMessage connectedMessage:
                    HandlePlayerConnected(connectedMessage);
                    break;
                case GlobalPlayerReconnectedMessage reconnectedMessage:
                    HandlePlayerReconnected(reconnectedMessage);
                    break;
                case GlobalPlayerDisconnectedMessage disconnectedMessage:
                    HandlePlayerDisconnected(disconnectedMessage);
                    break;
                case GlobalRemoveDisconnectedPlayerMessage removeDisconnectedPlayerMessage:
                    HandleRemoveDisconnectedPlayer(removeDisconnectedPlayerMessage);
                    break;
                case GlobalClientPacketMessage packetMessage:
                    HandleClientPacket(packetMessage);
                    break;
                default:
                    Console.WriteLine($"[GlobalWorld:{id}] Received unsupported message type '{message.GetType().Name}'.");
                    break;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine($"[GlobalWorld:{id}] Error handling message type '{message.GetType().Name}': {ex}");
        }
    }

    private void HandlePlayerConnected(GlobalPlayerConnectedMessage connectedMessage) {
        if (playersBySessionId.TryGetValue(connectedMessage.SessionId, out var existingPlayer)) {
            existingPlayer.SetCharacterName(connectedMessage.CharacterName);
            existingPlayer.AttachConnection(connectedMessage.SendMessage);
        } else {
            playersBySessionId.Add(
                connectedMessage.SessionId,
                new GlobalWorldPlayer(connectedMessage.SessionId, connectedMessage.SendMessage, connectedMessage.CharacterName));
        }

        Console.WriteLine($"[GlobalWorld:{id}] Player connected. Players on global world: {playersBySessionId.Count}");
    }

    private void HandlePlayerReconnected(GlobalPlayerReconnectedMessage reconnectedMessage) {
        if (!playersBySessionId.TryGetValue(reconnectedMessage.SessionId, out var player)) {
            playersBySessionId.Add(
                reconnectedMessage.SessionId,
                new GlobalWorldPlayer(reconnectedMessage.SessionId, reconnectedMessage.SendMessage, reconnectedMessage.CharacterName));
            Console.WriteLine($"[GlobalWorld:{id}] Reconnect arrived for missing session '{reconnectedMessage.SessionId}', recreated global player.");
            return;
        }

        player.SetCharacterName(reconnectedMessage.CharacterName);
        player.AttachConnection(reconnectedMessage.SendMessage);
        Console.WriteLine($"[GlobalWorld:{id}] Player reconnected. Players on global world: {playersBySessionId.Count}");
    }

    private void HandlePlayerDisconnected(GlobalPlayerDisconnectedMessage disconnectedMessage) {
        if (playersBySessionId.TryGetValue(disconnectedMessage.SessionId, out var player)) {
            player.DetachConnection();
        }

        Console.WriteLine($"[GlobalWorld:{id}] Player disconnected. Players on global world: {playersBySessionId.Count}");
    }

    private void HandleRemoveDisconnectedPlayer(GlobalRemoveDisconnectedPlayerMessage removeDisconnectedPlayerMessage) {
        if (!playersBySessionId.TryGetValue(removeDisconnectedPlayerMessage.SessionId, out var player)) {
            return;
        }
        if (!player.Disconnected) {
            return;
        }

        playersBySessionId.Remove(removeDisconnectedPlayerMessage.SessionId);
        Console.WriteLine($"[GlobalWorld:{id}] Removed disconnected player after grace period. Players on global world: {playersBySessionId.Count}");
    }

    private void HandleClientPacket(GlobalClientPacketMessage message) {
        if (!playersBySessionId.TryGetValue(message.SessionId, out var player)) {
            Console.WriteLine($"[GlobalWorld:{id}] Received packet for unknown session '{message.SessionId}'.");
            return;
        }

        switch (message.Message.PayloadCase) {
            case ClientMessage.PayloadOneofCase.ChatMessageSendRequest:
                HandleChatMessageSendRequest(player, message.Message.ChatMessageSendRequest);
                break;
            default:
                Console.WriteLine($"[GlobalWorld:{id}] Received unsupported packet '{message.Message.PayloadCase}'.");
                break;
        }
    }

    private void HandleChatMessageSendRequest(GlobalWorldPlayer sender, ChatMessageSendRequest request) {
        var message = request.Message.Trim();
        if (string.IsNullOrEmpty(message)) {
            sender.Send(NetworkManager.CreateSendMessage("Chat message cannot be empty."));
            return;
        }
        if (message.Length > chatMessageMaxLength) {
            sender.Send(NetworkManager.CreateSendMessage($"Chat message cannot exceed {chatMessageMaxLength} characters."));
            return;
        }

        var chatMessage = NetworkManager.CreateChatMessageReceived(
            sender.CharacterName,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            message);

        foreach (var player in playersBySessionId.Values) {
            if (!player.Disconnected) {
                player.Send(chatMessage);
            }
        }
    }
}
