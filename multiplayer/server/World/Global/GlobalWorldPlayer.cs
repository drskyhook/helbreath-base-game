using Mmorpg.Network;
using Server.World;

namespace Server.World.Global;

/// <summary>
/// Lightweight per-session state kept by <see cref="GlobalWorld"/> for cross-world features such as chat.
/// </summary>
public sealed class GlobalWorldPlayer {
    private Action<ServerMessage>? sendMessage;
    private string characterName = string.Empty;

    public GlobalWorldPlayer(Guid sessionId, Action<ServerMessage> sendMessage, string characterName) {
        ArgumentNullException.ThrowIfNull(sendMessage);
        SessionId = sessionId;
        AttachConnection(sendMessage);
        SetCharacterName(characterName);
    }

    /// <summary>Stable server session id shared with the owning <see cref="PlayerSession"/>.</summary>
    public Guid SessionId { get; }

    /// <summary>Latest authenticated character display name for chat and future global features.</summary>
    public string CharacterName => characterName;

    /// <summary>Whether this player is currently disconnected and should be skipped for fanout.</summary>
    public bool Disconnected { get; private set; }

    public void SetCharacterName(string value) {
        characterName = value.Trim();
    }

    public void AttachConnection(Action<ServerMessage> value) {
        ArgumentNullException.ThrowIfNull(value);
        sendMessage = value;
        Disconnected = false;
    }

    public void DetachConnection() {
        sendMessage = null;
        Disconnected = true;
    }

    public void Send(ServerMessage message) {
        ArgumentNullException.ThrowIfNull(message);
        sendMessage?.Invoke(message);
    }
}
