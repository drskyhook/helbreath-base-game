using Mmorpg.Network;
using Server;
using Server.World;
using Server.Utils;
using Server.World.Game;

namespace Server.Helpers;

/// <summary>Server-authoritative movement, occupancy updates, visibility fan-out, client movement packets, and admin/debug cell tools for a single <see cref="GameWorld"/>.</summary>
public static class Movement {
    /// <summary>Fills <paramref name="destination"/> with every spatial neighbor (including disconnect grace ghosts); uses <see cref="PlayersSpatialGrid.GetNearbyPlayers"/> with <c>excludeDisconnected: false</c> so range sets stay aligned with the grid.</summary>
    public static void FillNearbyPlayersById(
        PlayersSpatialGrid playersSpatialGrid,
        int centerX,
        int centerY,
        Guid excludedSessionId,
        Dictionary<long, GameWorldPlayer> destination) {
        ArgumentNullException.ThrowIfNull(playersSpatialGrid);
        ArgumentNullException.ThrowIfNull(destination);
        destination.Clear();
        foreach (var nearbyPlayer in playersSpatialGrid.GetNearbyPlayers(centerX, centerY, excludedSessionId, excludeDisconnected: false)) {
            destination[nearbyPlayer.PlayerId] = nearbyPlayer;
        }
    }

    /// <summary>Sends one <see cref="PlayersEnteredRange"/> with every <paramref name="sources"/> snapshot, then <see cref="PlayerDisconnected"/> for any disconnected ghost in that set.</summary>
    public static void SendPlayersSnapshotsBulk(GameWorldPlayer recipient, IEnumerable<GameWorldPlayer> sources) {
        ArgumentNullException.ThrowIfNull(recipient);
        ArgumentNullException.ThrowIfNull(sources);

        var enteredMessage = NetworkManager.CreatePlayersEnteredRange(sources);
        var bulk = enteredMessage.PlayersEnteredRange;
        if (bulk is null || bulk.Players.Count == 0) {
            return;
        }

        NetworkManager.SendToPlayer(recipient, enteredMessage);
        foreach (var nearby in sources) {
            if (nearby.Disconnected) {
                NetworkManager.SendToPlayer(recipient, NetworkManager.CreatePlayerDisconnected(nearby.PlayerId));
            }
        }
    }

    public static void SendPlayerSnapshot(GameWorldPlayer recipient, GameWorldPlayer nearbyPlayer) {
        ArgumentNullException.ThrowIfNull(recipient);
        ArgumentNullException.ThrowIfNull(nearbyPlayer);

        var enteredMessage = NetworkManager.CreatePlayersEnteredRange(nearbyPlayer);
        var bulk = enteredMessage.PlayersEnteredRange;
        if (bulk is null || bulk.Players.Count == 0) {
            return;
        }

        NetworkManager.SendToPlayer(recipient, enteredMessage);
        if (nearbyPlayer.Disconnected) {
            NetworkManager.SendToPlayer(recipient, NetworkManager.CreatePlayerDisconnected(nearbyPlayer.PlayerId));
        }
    }

    public static void SetPlayerPosition(GameWorldRef wr, GameWorldPlayer player, int x, int y) {
        ArgumentNullException.ThrowIfNull(player);
        wr.PlayerSpatialGrid.Move(player, x, y);
        player.SetPosition(x, y);
    }

    /// <summary>
    /// After a successful cell move: notifies overlapping observers of motion, adds/removes player range membership,
    /// and refreshes other visibility sets (monsters and ground effects) for the mover.
    /// </summary>
    /// <param name="broadcastPlayerMoved">When false, skips <see cref="PlayerMoved"/> (e.g. monster knockback: observers already get destination from <see cref="NetworkManager.CreatePlayerReceiveDamage"/>).</param>
    /// <param name="playerMovedTeleport">When true, <see cref="PlayerMoved"/> sets <c>Teleport</c> so clients snap observers to the destination instead of animating a step.</param>
    public static void SyncPlayerVisibilityAfterMovement(
        GameWorldRef wr,
        GameWorldPlayer movedPlayer,
        int curX,
        int curY,
        int destX,
        int destY,
        bool broadcastPlayerMoved = true,
        bool dashAttack = false,
        bool playerMovedTeleport = false) {
        ArgumentNullException.ThrowIfNull(movedPlayer);

        var playersPreviouslyInRange = wr.PlayersPreviouslyInRangeScratch;
        playersPreviouslyInRange.Clear();
        // After SetPlayerPosition, the mover is already on the grid at dest; do not rely only on
        // PlayersInRange (can miss neighbors for large jumps). Spatial query at cur uses each
        // candidate's live PosX/PosY, and the mover is excluded by session id.
        FillNearbyPlayersById(wr.PlayerSpatialGrid, curX, curY, movedPlayer.SessionId, wr.NearbyPlayersByIdScratch);
        foreach (var kv in wr.NearbyPlayersByIdScratch) {
            playersPreviouslyInRange.Add(kv.Key);
        }

        playersPreviouslyInRange.UnionWith(movedPlayer.PlayersInRange);

        FillNearbyPlayersById(wr.PlayerSpatialGrid, destX, destY, movedPlayer.SessionId, wr.NearbyPlayersByIdScratch);
        var playersNowInRange = wr.NearbyPlayersByIdScratch;
        var movedPlayerEnteredRangeMessage = NetworkManager.CreatePlayersEnteredRange(movedPlayer);
        var movedPlayerLeftRangeMessage = NetworkManager.CreatePlayersLeftRange(movedPlayer.PlayerId);

        if (broadcastPlayerMoved) {
            var playerMovedMessage = NetworkManager.CreatePlayerMoved(
                movedPlayer.PlayerId,
                curX,
                curY,
                destX,
                destY,
                movedPlayer.MovementSpeedMs,
                movedPlayer.RunningMode,
                dashAttack,
                playerMovedTeleport);
            foreach (var playerId in playersPreviouslyInRange) {
                if (!playersNowInRange.TryGetValue(playerId, out var nearbyPlayer)) {
                    continue;
                }
                if (nearbyPlayer.Disconnected) {
                    continue;
                }

                NetworkManager.SendToPlayer(nearbyPlayer, playerMovedMessage);
            }
        }

        var newNeighbors = wr.MovementNewNeighborsScratch;
        newNeighbors.Clear();
        foreach (var nearbyPlayer in playersNowInRange.Values) {
            if (playersPreviouslyInRange.Contains(nearbyPlayer.PlayerId)) {
                continue;
            }

            newNeighbors.Add(nearbyPlayer);
        }

        if (newNeighbors.Count > 0) {
            SendPlayersSnapshotsBulk(movedPlayer, newNeighbors);
            foreach (var nearbyPlayer in newNeighbors) {
                if (!nearbyPlayer.Disconnected) {
                    NetworkManager.SendToPlayer(nearbyPlayer, movedPlayerEnteredRangeMessage);
                    nearbyPlayer.AddPlayerInRange(movedPlayer.PlayerId);
                }
            }
        }

        var leftNeighborIds = wr.MovementLeftNeighborIdsScratch;
        leftNeighborIds.Clear();
        foreach (var playerId in playersPreviouslyInRange) {
            if (playersNowInRange.ContainsKey(playerId)) {
                continue;
            }

            leftNeighborIds.Add(playerId);
        }

        if (leftNeighborIds.Count > 0) {
            NetworkManager.SendToPlayer(movedPlayer, NetworkManager.CreatePlayersLeftRange(leftNeighborIds));
            foreach (var playerId in leftNeighborIds) {
                if (!wr.World.TryGetConnectedPlayerById(playerId, out var noLongerNearbyPlayer)) {
                    continue;
                }

                if (!noLongerNearbyPlayer.Disconnected) {
                    NetworkManager.SendToPlayer(noLongerNearbyPlayer, movedPlayerLeftRangeMessage);
                    noLongerNearbyPlayer.RemovePlayerInRange(movedPlayer.PlayerId);
                }
            }
        }

        movedPlayer.ReplacePlayersInRange(playersNowInRange.Keys);
        MonsterVisibility.SyncPlayerMonsterVisibilityAfterMovement(wr, movedPlayer);
        Npc.SyncPlayerNpcVisibilityAfterMovement(wr, movedPlayer);
        GroundStateVisibility.SyncPlayerGroundStateAfterMovement(wr, movedPlayer);
        MonsterChase.EvaluateChaseForPlayer(wr, movedPlayer);
    }

    /// <summary>Admin/debug: marks a map cell occupied without moving a player.</summary>
    public static void HandleMakeServerCellOccupiedRequest(GameWorldRef wr, int x, int y, string worldIdForLog) {
        wr.OccupancyTracker.SetOccupied(x, y);
        Console.WriteLine($"[GameWorld:{worldIdForLog}] Cell occupied manually at ({x}, {y})");
    }

    /// <summary>Moves the requesting player to a free cell, updates occupancy, runs visibility sync, then sends <see cref="PlayerTeleported"/> to that client.</summary>
    public static void HandlePlayerTeleportRequested(GameWorldRef wr, GameWorldPlayer player, PlayerTeleportRequested request, string worldIdForLog) {
        if (player.IsDead) {
            return;
        }

        var destX = request.X;
        var destY = request.Y;
        if (destX == player.PosX && destY == player.PosY) {
            return;
        }

        if (!wr.OccupancyTracker.IsFree(destX, destY)) {
            return;
        }

        var prevX = player.PosX;
        var prevY = player.PosY;
        wr.OccupancyTracker.SetFree(prevX, prevY);
        wr.OccupancyTracker.SetOccupied(destX, destY);
        SetPlayerPosition(wr, player, destX, destY);
        SyncPlayerVisibilityAfterMovement(
            wr,
            player,
            prevX,
            prevY,
            destX,
            destY,
            broadcastPlayerMoved: true,
            dashAttack: false,
            playerMovedTeleport: true);
        Combat.ApplyGroundEffectStepDamageToPlayer(wr, player);
        NetworkManager.SendToPlayer(player, NetworkManager.CreatePlayerTeleported(destX, destY));
        Console.WriteLine($"[GameWorld:{worldIdForLog}] Player {player.PlayerId} teleported to ({destX}, {destY})");
    }

    /// <summary>
    /// Validates client-reported step against occupancy, optional course correction, jump distance, paralysis, and movement cadence;
    /// applies anti-cheat paralysis and rollback on excessive speed.
    /// Also requires <c>dest</c> to be exactly one Chebyshev step from the server cell so stale packets (e.g. after knockback) cannot teleport;
    /// when <c>dest</c> equals the server cell (distance 0), the packet is treated as a duplicate and ignored.
    /// </summary>
    public static void HandleRequestMovement(GameWorldRef wr, GameWorldPlayer playerConnection, RequestMovement requestMovement) {
        if (playerConnection.IsDead) {
            return;
        }
        var now = DateTimeOffset.UtcNow;
        if (playerConnection.IsPickupOrBowStanceLockoutActive(now)) {
            return;
        }
        if (playerConnection.SpawnProtection) {
            Spawn.DisableSpawnProtectionAndNotify(wr, playerConnection);
        }

        var deltaMs = playerConnection.GetAndUpdateLastMovementRequestMs();
        if (playerConnection.IsServerForcedParalysisActive()) {
            NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreateResetPosition(wr.WorldId, playerConnection.PosX, playerConnection.PosY));
            return;
        }
        var nowUnixMs = now.ToUnixTimeMilliseconds();
        if (playerConnection.IsMovementStunlockViolation(nowUnixMs, out var cappedPingVariance, out var requiredWaitMs)) {
            // Only snap back when the client's reported step origin is far from our authoritative cell (Chebyshev > 1).
            // Within one cell we tolerate clock/network skew vs strict stunlock timing; larger drift suggests tampering or a client that never applied stun.
            var clientVsServerChebyshev = Location.GetDistance(
                requestMovement.CurX,
                requestMovement.CurY,
                playerConnection.PosX,
                playerConnection.PosY);
            if (clientVsServerChebyshev > 1) {
                var remainingStunlockMs = playerConnection.GetRemainingCombatStunlockMs(now);
                NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreateResetPosition(wr.WorldId, playerConnection.PosX, playerConnection.PosY, remainingStunlockMs));
                return;
            }
        }
        var clientCurVsServerChebyshev = Location.GetDistance(requestMovement.CurX, requestMovement.CurY, playerConnection.PosX, playerConnection.PosY);
        if (clientCurVsServerChebyshev > wr.Settings.MaxCellsJumpDistance) {
            NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreateResetPosition(wr.WorldId, playerConnection.PosX, playerConnection.PosY));
            return;
        }
        // Require dest to be exactly one Chebyshev step from the server cell so stale packets (e.g. after knockback) cannot teleport.
        // serverToDest == 0 means dest equals the server's cell: duplicate or late packet for a step already applied — ignore without reset.
        var serverToDestChebyshev = Location.GetDistance(
            playerConnection.PosX,
            playerConnection.PosY,
            requestMovement.DestX,
            requestMovement.DestY);
        if (serverToDestChebyshev == 0) {
            return;
        }
        if (serverToDestChebyshev != 1) {
            var remainingStunlockMs = playerConnection.GetRemainingCombatStunlockMs(now);
            NetworkManager.SendToPlayer(
                playerConnection,
                NetworkManager.CreateResetPosition(
                    wr.WorldId,
                    playerConnection.PosX,
                    playerConnection.PosY,
                    remainingStunlockMs));
            return;
        }
        if (!wr.OccupancyTracker.IsFree(requestMovement.DestX, requestMovement.DestY)) {
            var curX = playerConnection.PosX;
            var curY = playerConnection.PosY;
            if (wr.Settings.CourseCorrection) {
                var (leftX, leftY, rightX, rightY) = Location.GetAdjacentCellsAt45DegreeOffset(curX, curY, requestMovement.DestX, requestMovement.DestY);
                if (wr.OccupancyTracker.IsFree(leftX, leftY)) {
                    wr.OccupancyTracker.SetFree(curX, curY);
                    wr.OccupancyTracker.SetOccupied(leftX, leftY);
                    SetPlayerPosition(wr, playerConnection, leftX, leftY);
                    ApplyFacingFromStep(playerConnection, curX, curY, leftX, leftY);
                    SyncPlayerVisibilityAfterMovement(
                        wr,
                        playerConnection,
                        curX,
                        curY,
                        leftX,
                        leftY);
                    Combat.ApplyGroundEffectStepDamageToPlayer(wr, playerConnection);
                    NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreatePositionCorrected(wr.WorldId, curX, curY, leftX, leftY));
                    return;
                }
                if (wr.OccupancyTracker.IsFree(rightX, rightY)) {
                    wr.OccupancyTracker.SetFree(curX, curY);
                    wr.OccupancyTracker.SetOccupied(rightX, rightY);
                    SetPlayerPosition(wr, playerConnection, rightX, rightY);
                    ApplyFacingFromStep(playerConnection, curX, curY, rightX, rightY);
                    SyncPlayerVisibilityAfterMovement(
                        wr,
                        playerConnection,
                        curX,
                        curY,
                        rightX,
                        rightY);
                    Combat.ApplyGroundEffectStepDamageToPlayer(wr, playerConnection);
                    NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreatePositionCorrected(wr.WorldId, curX, curY, rightX, rightY));
                    return;
                }
            }
            NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreateResetPosition(wr.WorldId, playerConnection.PosX, playerConnection.PosY));
            return;
        }
        var previousX = playerConnection.PosX;
        var previousY = playerConnection.PosY;
        // Validate cadence before mutating occupancy / broadcasting so neighbors never see a move that is rolled back (M7).
        if (deltaMs > 0 && !playerConnection.CheckMovementSpeedViolation(deltaMs)) {
            var paralysisSeconds = wr.Settings.MovementSpeedViolationsChecker.ParalysisDuration;
            if (wr.Settings.MovementSpeedViolationsChecker.Verbose) {
                Console.WriteLine($"[GameWorld:{wr.WorldId}] Erratic player movement speed detected for player {playerConnection.PlayerId}. Sending warning and applying {paralysisSeconds}s paralysis.");
            }
            playerConnection.SetServerForcedParalysisUntil(now.AddSeconds(paralysisSeconds));
            NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreatePlayerParalyzed(paralysisSeconds));
            NetworkManager.SendToPlayer(playerConnection, NetworkManager.CreateSendMessage(
                $"You've caught having erratic movement speed. This is a warning, if you're meddling with things you shouldn't, stop doing that, otherwise you'll get banned. For now, as a punishment, you'll have to stand still for {paralysisSeconds} seconds."));
            return;
        }

        wr.OccupancyTracker.SetFree(previousX, previousY);
        wr.OccupancyTracker.SetOccupied(requestMovement.DestX, requestMovement.DestY);
        SetPlayerPosition(wr, playerConnection, requestMovement.DestX, requestMovement.DestY);
        SyncPlayerVisibilityAfterMovement(
            wr,
            playerConnection,
            previousX,
            previousY,
            requestMovement.DestX,
            requestMovement.DestY,
            dashAttack: requestMovement.DashAttack);

        ApplyFacingFromStep(playerConnection, previousX, previousY, requestMovement.DestX, requestMovement.DestY);
        Combat.ApplyGroundEffectStepDamageToPlayer(wr, playerConnection);
        Combat.HandlePlayerDashAttackAfterMovement(wr, playerConnection, requestMovement);
    }

    private static void ApplyFacingFromStep(GameWorldPlayer player, int fromX, int fromY, int toX, int toY) {
        var dir = Location.GetNextGridDirection(fromX, fromY, toX, toY);
        if (dir >= 0) {
            player.SetFacingDirection(dir);
        }
    }

    public static void HandleChangePlayerMovementSpeed(GameWorldRef wr, GameWorldPlayer player, ChangePlayerMovementSpeedRequest request) {
        if (player.IsPickupOrBowStanceLockoutActive(DateTimeOffset.UtcNow)) {
            return;
        }
        player.SetMovementSpeedMs(request.MovementSpeedMs);
        var selfSync = NetworkManager.CreatePlayerMovementStateChanged(player.PlayerId, player.RunningMode, player.MovementSpeedMs);
        NetworkManager.SendToPlayer(player, selfSync);
    }

    public static void HandlePlayerMovementStateChange(GameWorldRef wr, GameWorldPlayer player, PlayerMovementStateChangeRequest request) {
        if (player.IsPickupOrBowStanceLockoutActive(DateTimeOffset.UtcNow)) {
            return;
        }
        player.SetRunningMode(request.RunningMode);
        var message = NetworkManager.CreatePlayerMovementStateChanged(player.PlayerId, player.RunningMode, player.MovementSpeedMs);
        // Spatial query excludes the mover; send authoritative effective ms so the client walk/run animation matches chill.
        NetworkManager.SendToPlayer(player, message);
        foreach (var nearbyPlayer in wr.PlayerSpatialGrid.GetNearbyPlayers(player.PosX, player.PosY, player.SessionId)) {
            NetworkManager.SendToPlayer(nearbyPlayer, message);
        }
    }

    public static void HandlePlayerAttackModeChange(GameWorldRef wr, GameWorldPlayer player, PlayerAttackModeChangeRequest request) {
        if (player.IsPickupOrBowStanceLockoutActive(DateTimeOffset.UtcNow)) {
            return;
        }
        player.SetAttackMode(request.AttackMode);
        var message = NetworkManager.CreatePlayerAttackModeChanged(player.PlayerId, player.AttackMode);
        foreach (var nearbyPlayer in wr.PlayerSpatialGrid.GetNearbyPlayers(player.PosX, player.PosY, player.SessionId)) {
            NetworkManager.SendToPlayer(nearbyPlayer, message);
        }
    }

    /// <summary>Authoritative idle facing (grid 0–7); fans out to nearby observers. Sender already applied locally.</summary>
    public static void HandleChangePlayerIdleDirection(GameWorldRef wr, GameWorldPlayer player, ChangePlayerIdleDirectionRequest request) {
        if (player.IsPickupOrBowStanceLockoutActive(DateTimeOffset.UtcNow)) {
            return;
        }
        var d = request.Direction;
        if (d < 0 || d > 7) {
            return;
        }

        player.SetFacingDirection(d);
        var message = NetworkManager.CreatePlayerIdleDirectionChanged(player.PlayerId, d);
        foreach (var nearbyPlayer in wr.PlayerSpatialGrid.GetNearbyPlayers(player.PosX, player.PosY, player.SessionId)) {
            NetworkManager.SendToPlayer(nearbyPlayer, message);
        }
    }
}
