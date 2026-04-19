using Mmorpg.Network;
using Server;
using Server.World;
using Server.Utils;
using Server.World.Game;

namespace Server.Helpers;

/// <summary>Ping RTT sampling, queue-depth reporting, and periodic disconnects for stale or highly variable clients.</summary>
public static class Ping {
    public static void HandlePingRequest(GameWorldRef wr, GameWorldPlayer playerConnection, PingRequest pingRequest) {
        var gameWorldQueueLength = wr.IncomingReader.Count;
        var playersInMap = wr.World.ConnectedPlayerCount;
        NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreatePingResponse(pingRequest.Sequence, gameWorldQueueLength, playersInMap, playerConnection.PingVariance));
        playerConnection.GetPingDeltaAndUpdateLastPingMs(wr.Settings.Ping.Interval);
    }

    /// <summary>Scheduler callback: disconnects players who miss pings or exceed configured variance (tab suspend / unstable links).</summary>
    public static void CheckPingVarianceAndDisconnectExcessive(GameWorldRef wr) {
        var maxPingVariance = wr.Settings.Ping.AllowedVariance;
        var maxPingTimeout = wr.Settings.Ping.Timeout;
        var currentMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var player in wr.World.EnumerateConnectedPlayers()) {
            if (player.Disconnected) {
                continue;
            }
            if (player.LastPingTimeMs <= 0) {
                continue;
            }
            if (currentMs - player.LastPingTimeMs > maxPingTimeout) {
                Console.WriteLine($"[GameWorld:{wr.WorldId}] Player {player.PlayerId} disconnected due to not receiving ping in time (last ping: {currentMs - player.LastPingTimeMs}ms ago, max: {maxPingTimeout}ms)");
                player.RequestDisconnect("You were disconnected due to not receiving ping in time. Most likely cause was because the game browser tab was suspended.");
                continue;
            }
            if (player.PingVariance <= maxPingVariance) {
                continue;
            }

            Console.WriteLine($"[GameWorld:{wr.WorldId}] Player {player.PlayerId} disconnected due to having too high ping variance (variance: {player.PingVariance:F2}, max: {maxPingVariance})");
            player.RequestDisconnect("You were disconnected due to having too high ping. Most likely cause was because the game browser tab was suspended.");
        }
    }
}
