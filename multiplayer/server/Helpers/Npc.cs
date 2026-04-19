using System.Collections.Generic;
using Mmorpg.Network;
using Server;
using Server.Utils;
using Server.World;
using Server.World.Game;

namespace Server.Helpers;

/// <summary>
/// NPC summon/removal, view-radius queries, and bulk enter/leave packets. NPCs do not track which players see them.
/// </summary>
public static class Npc {
    /// <summary>Clears <paramref name="destination"/> and fills it with every <see cref="GameWorldNPC"/> in <see cref="GameWorldRef.NpcSpatialGrid"/> within view of <paramref name="centerX"/>, <paramref name="centerY"/>.</summary>
    public static void FillNearbyNpcsById(GameWorldRef wr, int centerX, int centerY, Dictionary<long, GameWorldNPC> destination) {
        ArgumentNullException.ThrowIfNull(destination);
        destination.Clear();
        foreach (var npc in wr.NpcSpatialGrid.GetNearbyNpcs(centerX, centerY)) {
            destination[npc.NpcId] = npc;
        }
    }

    /// <summary>Reconciles <paramref name="player"/>.<see cref="GameWorldPlayer.NpcsInRange"/> after they moved to <see cref="GameWorldPlayer.PosX"/>/<c>PosY</c>.</summary>
    public static void SyncPlayerNpcVisibilityAfterMovement(GameWorldRef wr, GameWorldPlayer player) {
        ArgumentNullException.ThrowIfNull(player);

        wr.NpcsPreviouslyInRangeScratch.Clear();
        wr.NpcsPreviouslyInRangeScratch.UnionWith(player.NpcsInRange);

        FillNearbyNpcsById(wr, player.PosX, player.PosY, wr.NearbyNpcsByIdScratch);
        var npcsNow = wr.NearbyNpcsByIdScratch;

        var entered = wr.PlayerNpcVisibilityEnteredScratch;
        var left = wr.PlayerNpcVisibilityLeftNpcIdsScratch;
        entered.Clear();
        left.Clear();
        foreach (var kv in npcsNow) {
            if (!wr.NpcsPreviouslyInRangeScratch.Contains(kv.Key)) {
                entered.Add(kv.Value);
            }
        }

        foreach (var npcId in wr.NpcsPreviouslyInRangeScratch) {
            if (!npcsNow.ContainsKey(npcId)) {
                left.Add(npcId);
            }
        }

        if (entered.Count > 0 && !player.Disconnected) {
            NetworkManager.SendToPlayer(player, NetworkManager.CreateNpcsEnteredRange(entered));
        }

        if (left.Count > 0 && !player.Disconnected) {
            NetworkManager.SendToPlayer(player, NetworkManager.CreateNpcsLeftRange(left));
        }

        player.ReplaceNpcsInRange(npcsNow.Keys);
    }

    /// <summary>Sends bulk enter for NPCs near <paramref name="player"/> on join or reconnect.</summary>
    public static void SendNpcsInRangeOnPlayerJoin(GameWorldRef wr, GameWorldPlayer player) {
        ArgumentNullException.ThrowIfNull(player);

        FillNearbyNpcsById(wr, player.PosX, player.PosY, wr.NearbyNpcsByIdScratch);
        var nearby = wr.NearbyNpcsByIdScratch;
        if (nearby.Count > 0 && !player.Disconnected) {
            NetworkManager.SendToPlayer(player, NetworkManager.CreateNpcsEnteredRange(nearby.Values));
        }

        player.ReplaceNpcsInRange(nearby.Keys);
    }

    /// <summary>Places one catalog NPC at a fixed cell when the world is constructed (no visibility broadcast; no players yet).</summary>
    public static void SpawnWorldNpcAtCell(GameWorldRef wr, int catalogNpcId, int x, int y, int facing) {
        if (!wr.NpcsById.ContainsKey(catalogNpcId)) {
            throw new InvalidOperationException($"Unknown NPC catalog id {catalogNpcId}.");
        }
        if (facing < 0 || facing > 7) {
            throw new ArgumentOutOfRangeException(nameof(facing), "Facing direction must be 0-7.");
        }

        var owns = wr.OccupancyTracker.IsFree(x, y);
        if (owns) {
            wr.OccupancyTracker.SetOccupied(x, y);
        }

        var npcGuid = Guid.NewGuid();
        var npcId = BitConverter.ToInt64(npcGuid.ToByteArray(), 0);
        var npc = new GameWorldNPC(npcId, catalogNpcId, x, y, facing, ownsOccupancyCell: owns);
        wr.NpcsByNpcId[npcId] = npc;
        wr.NpcSpatialGrid.Add(npc, x, y);
    }

    /// <summary>Notifies connected players near the spawn cell; updates each recipient's in-range set. NPCs do not record viewer ids.</summary>
    public static void BroadcastNpcSpawnToNearbyPlayers(GameWorldRef wr, GameWorldNPC spawned) {
        ArgumentNullException.ThrowIfNull(spawned);

        var message = NetworkManager.CreateNpcsEnteredRange(spawned);
        foreach (var recipient in wr.PlayerSpatialGrid.GetNearbyPlayers(spawned.PosX, spawned.PosY, null, excludeDisconnected: true)) {
            if (recipient.IsNpcInRange(spawned.NpcId)) {
                continue;
            }

            NetworkManager.SendToPlayer(recipient, message);
            recipient.AddNpcInRange(spawned.NpcId);
        }
    }

    /// <summary>Summons one NPC instance on a free cell near the player (debug / admin).</summary>
    public static void HandleSummonNpcRequest(GameWorldRef wr, string worldId, GameWorldPlayer player, SummonNpcRequest request) {
        ArgumentNullException.ThrowIfNull(worldId);
        ArgumentNullException.ThrowIfNull(player);
        ArgumentNullException.ThrowIfNull(request);

        if (player.IsDead) {
            return;
        }
        if (player.IsPickupOrBowStanceLockoutActive(DateTimeOffset.UtcNow)) {
            return;
        }
        var catalogId = request.CatalogNpcId;
        if (!wr.NpcsById.ContainsKey(catalogId)) {
            Console.WriteLine($"[GameWorld:{worldId}] Unknown NPC catalog id {catalogId} from player '{player.PlayerId}'.");
            return;
        }
        var facing = request.Direction;
        if (facing < 0 || facing > 7) {
            return;
        }
        var summonSearchRadius = Math.Max(wr.OccupancyTracker.SizeX, wr.OccupancyTracker.SizeY);
        var freeCell = Location.FindNearestFreeLocation(
            wr.OccupancyTracker.IsFreeAndNotTeleportCell,
            player.PosX,
            player.PosY,
            summonSearchRadius);
        if (!freeCell.HasValue) {
            Console.WriteLine($"[GameWorld:{worldId}] No free cell near player '{player.PlayerId}' for NPC summon.");
            return;
        }
        var spawnX = freeCell.Value.X;
        var spawnY = freeCell.Value.Y;
        var npcGuid = Guid.NewGuid();
        var npcId = BitConverter.ToInt64(npcGuid.ToByteArray(), 0);
        var npc = new GameWorldNPC(npcId, catalogId, spawnX, spawnY, facing, ownsOccupancyCell: true);
        wr.OccupancyTracker.SetOccupied(spawnX, spawnY);
        wr.NpcsByNpcId[npcId] = npc;
        wr.NpcSpatialGrid.Add(npc, spawnX, spawnY);
        BroadcastNpcSpawnToNearbyPlayers(wr, npc);
        Console.WriteLine($"[GameWorld:{worldId}] Summoned NPC catalog {catalogId} (instance {npcId}) at ({spawnX},{spawnY}) for player '{player.PlayerId}'.");
    }

    /// <summary>Removes every NPC instance on the map (debug / admin).</summary>
    public static void HandleKillAllNpcsRequest(GameWorldRef wr, GameWorldPlayer player) {
        ArgumentNullException.ThrowIfNull(player);

        if (player.IsDead) {
            return;
        }
        if (player.IsPickupOrBowStanceLockoutActive(DateTimeOffset.UtcNow)) {
            return;
        }
        var toRemove = new List<GameWorldNPC>(wr.NpcsByNpcId.Values);
        foreach (var npc in toRemove) {
            RemoveNpcFromMap(wr, npc);
        }
    }

    /// <summary>Removes an NPC from the map and notifies viewers who had it in range.</summary>
    public static void RemoveNpcFromMap(GameWorldRef wr, GameWorldNPC npc) {
        ArgumentNullException.ThrowIfNull(npc);
        if (!wr.NpcsByNpcId.TryGetValue(npc.NpcId, out var existing) || !ReferenceEquals(existing, npc)) {
            return;
        }

        var leftMessage = NetworkManager.CreateNpcsLeftRange(npc.NpcId);
        foreach (var viewer in wr.PlayerSpatialGrid.GetNearbyPlayers(npc.PosX, npc.PosY, excludeDisconnected: false)) {
            if (!viewer.IsNpcInRange(npc.NpcId)) {
                continue;
            }

            if (!viewer.Disconnected) {
                NetworkManager.SendToPlayer(viewer, leftMessage);
            }

            viewer.RemoveNpcInRange(npc.NpcId);
        }

        if (npc.OwnsOccupancyCell) {
            wr.OccupancyTracker.SetFree(npc.PosX, npc.PosY);
        }
        wr.NpcSpatialGrid.Remove(npc);
        wr.NpcsByNpcId.Remove(npc.NpcId);
    }
}
