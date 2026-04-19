using Mmorpg.Network;
using Server.World;
using Server.World.Game;

namespace Server.World.Global;

/// <summary>
/// Central allowlist for client packet payloads that should be handled by <see cref="GlobalWorld"/> instead of a playable <see cref="GameWorld"/>.
/// </summary>
public static class GlobalPacketRouting {
    private static readonly HashSet<ClientMessage.PayloadOneofCase> globalPayloadCases = new() {
        ClientMessage.PayloadOneofCase.ChatMessageSendRequest,
    };

    public static bool ShouldRouteToGlobalWorld(ClientMessage message) {
        ArgumentNullException.ThrowIfNull(message);
        return ShouldRouteToGlobalWorld(message.PayloadCase);
    }

    public static bool ShouldRouteToGlobalWorld(ClientMessage.PayloadOneofCase payloadCase) {
        return globalPayloadCases.Contains(payloadCase);
    }
}
