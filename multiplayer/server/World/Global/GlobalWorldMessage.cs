using Mmorpg.Network;
using Server.World;
using Server.World.Game;

namespace Server.World.Global;

/// <summary>Base type for messages delivered to the singleton <see cref="GlobalWorld"/> mailbox.</summary>
public abstract record GlobalWorldMessage;

/// <summary>First-time join into the global world: session id, current send callback, and authenticated character name.</summary>
public sealed record GlobalPlayerConnectedMessage(
    Guid SessionId,
    Action<ServerMessage> SendMessage,
    string CharacterName) : GlobalWorldMessage;

/// <summary>Existing global player reattached to a new socket during reconnect grace.</summary>
public sealed record GlobalPlayerReconnectedMessage(
    Guid SessionId,
    Action<ServerMessage> SendMessage,
    string CharacterName) : GlobalWorldMessage;

/// <summary>Socket closed; the player remains in the global world until cleanup removes the session.</summary>
public sealed record GlobalPlayerDisconnectedMessage(Guid SessionId, bool SessionRemainsActive) : GlobalWorldMessage;

/// <summary>Final removal after reconnect grace expired.</summary>
public sealed record GlobalRemoveDisconnectedPlayerMessage(Guid SessionId) : GlobalWorldMessage;

/// <summary>Client packet already classified as globally routed by the network edge.</summary>
public sealed record GlobalClientPacketMessage(Guid SessionId, ClientMessage Message) : GlobalWorldMessage;
