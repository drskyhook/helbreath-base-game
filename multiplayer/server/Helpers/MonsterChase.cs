using System;
using System.Collections.Generic;
using Mmorpg.Network;
using Server.World;
using Server.World.Game;

namespace Server.Helpers;

/// <summary>
/// Aggro checks when a player or monster cell changes: resolves player or monster combat targets from allegiance rules while keeping
/// existing valid targets when they still match the highest-priority available target class for that monster.
/// </summary>
public static class MonsterChase {
    /// <summary>After a player moved: for each monster they see, let hostile monsters prefer nearby players over monster targets.</summary>
    public static void EvaluateChaseForPlayer(GameWorldRef wr, GameWorldPlayer player) {
        ArgumentNullException.ThrowIfNull(player);

        if (player.SpawnProtection) {
            foreach (var monsterId in player.MonstersInRange) {
                if (!wr.MonstersByMonsterId.TryGetValue(monsterId, out var m)) {
                    continue;
                }

                m.StopChasingPlayerIfTarget(player.PlayerId);
            }

            return;
        }

        foreach (var monsterId in player.MonstersInRange) {
            if (!wr.MonstersByMonsterId.TryGetValue(monsterId, out var monster)) {
                continue;
            }

            if (!CanAutoTargetPlayers(monster)) {
                continue;
            }

            if (monster.TargetKind == GameWorldMonster.CombatTargetKind.Player &&
                monster.TargetedPlayerId.HasValue &&
                TryGetValidPlayerTarget(wr, monster, monster.TargetedPlayerId.Value, out _)) {
                continue;
            }

            if (!IsPlayerCandidateInChaseRange(monster, player)) {
                continue;
            }

            if (player.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
                continue;
            }

            monster.SetTargetedPlayer(player.PlayerId);
        }
    }

    /// <summary>After a monster stepped or during idle evaluation: preserve a valid target when it still matches the monster's highest-priority candidate class; otherwise pick a new nearby player or monster target from allegiance rules.</summary>
    public static void EvaluateChaseForMonster(GameWorldRef wr, GameWorldMonster monster) {
        ArgumentNullException.ThrowIfNull(monster);
        EvaluateMonsterTargetCore(wr, monster);
    }

    /// <summary>
    /// Same rules as <see cref="EvaluateChaseForMonster(GameWorldRef, GameWorldMonster)"/>; the viewer map is available from visibility sync but combat selection now resolves directly from world state.
    /// </summary>
    public static void EvaluateChaseForMonster(GameWorldRef wr, GameWorldMonster monster, Dictionary<long, GameWorldPlayer> viewersAfterStep) {
        ArgumentNullException.ThrowIfNull(monster);
        ArgumentNullException.ThrowIfNull(viewersAfterStep);
        EvaluateMonsterTargetCore(wr, monster);
    }

    private static void EvaluateMonsterTargetCore(GameWorldRef wr, GameWorldMonster monster) {
        if (monster.TargetKind == GameWorldMonster.CombatTargetKind.Player &&
            monster.TargetedPlayerId.HasValue &&
            TryGetPreservedPlayerTarget(wr, monster, monster.TargetedPlayerId.Value, out _)) {
            return;
        }

        if (monster.TargetKind == GameWorldMonster.CombatTargetKind.Monster &&
            monster.TargetedMonsterId.HasValue &&
            TryGetPreservedMonsterTarget(wr, monster, monster.TargetedMonsterId.Value, out _)) {
            return;
        }

        if (CanAutoTargetPlayers(monster)) {
            if (TryGetValidPlayerTarget(wr, monster, out var bestPlayerId)) {
                monster.SetTargetedPlayer(bestPlayerId);
                return;
            }
        }

        if (monster.TargetKind == GameWorldMonster.CombatTargetKind.Player && monster.TargetedPlayerId.HasValue) {
            monster.StopChasingPlayerIfTarget(monster.TargetedPlayerId.Value);
        }

        if (CanAutoTargetMonsters(monster)) {
            if (TryGetValidMonsterTarget(wr, monster, out var bestMonsterId)) {
                monster.SetTargetedMonster(bestMonsterId);
                return;
            }
        }
    }

    private static bool CanAutoTargetPlayers(GameWorldMonster monster) {
        return monster.Allegiance == MonsterAllegiance.Hostile;
    }

    private static bool CanAutoTargetMonsters(GameWorldMonster monster) {
        return monster.Allegiance == MonsterAllegiance.Hostile || monster.Allegiance == MonsterAllegiance.Friendly;
    }

    private static bool TryGetValidPlayerTarget(GameWorldRef wr, GameWorldMonster monster, out long bestPlayerId) {
        bestPlayerId = default;
        long? bestId = null;
        var bestDist = int.MaxValue;
        foreach (var playerId in monster.PlayersInRange) {
            if (!wr.World.TryGetConnectedPlayerById(playerId, out var player)) {
                continue;
            }

            if (!ConsiderPlayerCandidate(monster, player, ref bestDist, ref bestId)) {
                continue;
            }
        }

        if (!bestId.HasValue) {
            return false;
        }

        bestPlayerId = bestId.Value;
        return true;
    }

    private static bool TryGetValidPlayerTarget(GameWorldRef wr, GameWorldMonster monster, long playerId, out GameWorldPlayer? player) {
        player = null;
        if (!wr.World.TryGetConnectedPlayerById(playerId, out var resolved)) {
            return false;
        }

        if (!monster.IsOngoingChaseTargetStillValid(resolved) || !IsPlayerCandidateInChaseRange(monster, resolved)) {
            return false;
        }

        if (resolved.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        player = resolved;
        return true;
    }

    private static bool TryGetPreservedPlayerTarget(GameWorldRef wr, GameWorldMonster monster, long playerId, out GameWorldPlayer? player) {
        player = null;
        if (!wr.World.TryGetConnectedPlayerById(playerId, out var resolved)) {
            return false;
        }

        if (!monster.IsOngoingChaseTargetStillValid(resolved)) {
            return false;
        }

        if (resolved.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        player = resolved;
        return true;
    }

    private static bool TryGetValidMonsterTarget(GameWorldRef wr, GameWorldMonster monster, out long bestMonsterId) {
        bestMonsterId = default;
        long? bestId = null;
        var bestDist = int.MaxValue;
        foreach (var candidate in wr.MonsterSpatialGrid.GetNearbyMonsters(monster.PosX, monster.PosY)) {
            if (!ConsiderMonsterCandidate(wr, monster, candidate, ref bestDist, ref bestId)) {
                continue;
            }
        }

        if (!bestId.HasValue) {
            return false;
        }

        bestMonsterId = bestId.Value;
        return true;
    }

    private static bool TryGetValidMonsterTarget(GameWorldRef wr, GameWorldMonster monster, long monsterId, out GameWorldMonster? target) {
        target = null;
        if (!wr.World.TryGetMonsterByMonsterId(monsterId, out var resolved)) {
            return false;
        }

        if (!CanMonsterAutoTargetMonster(monster, resolved) || !monster.IsOngoingChaseTargetStillValid(resolved, wr.Settings)) {
            return false;
        }

        if (resolved.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        target = resolved;
        return true;
    }

    private static bool TryGetPreservedMonsterTarget(GameWorldRef wr, GameWorldMonster monster, long monsterId, out GameWorldMonster? target) {
        target = null;
        if (!wr.World.TryGetMonsterByMonsterId(monsterId, out var resolved)) {
            return false;
        }

        if (!monster.IsOngoingChaseTargetStillValid(resolved, wr.Settings)) {
            return false;
        }

        if (resolved.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        target = resolved;
        return true;
    }

    private static bool ConsiderPlayerCandidate(GameWorldMonster monster, GameWorldPlayer player, ref int bestDist, ref long? bestId) {
        if (!IsPlayerCandidateInChaseRange(monster, player)) {
            return false;
        }

        if (player.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        var distance = Location.GetDistance(monster.PosX, monster.PosY, player.PosX, player.PosY);
        if (distance < bestDist) {
            bestDist = distance;
            bestId = player.PlayerId;
        }

        return true;
    }

    private static bool ConsiderMonsterCandidate(GameWorldRef wr, GameWorldMonster source, GameWorldMonster candidate, ref int bestDist, ref long? bestId) {
        if (!CanMonsterAutoTargetMonster(source, candidate) || !source.IsOngoingChaseTargetStillValid(candidate, wr.Settings)) {
            return false;
        }

        if (candidate.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        var distance = Location.GetDistance(source.PosX, source.PosY, candidate.PosX, candidate.PosY);
        if (distance > source.ChaseDistanceCells) {
            return false;
        }

        if (distance < bestDist) {
            bestDist = distance;
            bestId = candidate.MonsterId;
        }

        return true;
    }

    private static bool IsPlayerCandidateInChaseRange(GameWorldMonster monster, GameWorldPlayer player) {
        if (player.IsDead || player.SpawnProtection) {
            return false;
        }

        var distance = Location.GetDistance(monster.PosX, monster.PosY, player.PosX, player.PosY);
        return distance <= monster.ChaseDistanceCells;
    }

    private static bool CanMonsterAutoTargetMonster(GameWorldMonster source, GameWorldMonster candidate) {
        if (candidate.Dead || source.MonsterId == candidate.MonsterId) {
            return false;
        }

        return source.Allegiance switch {
            MonsterAllegiance.Hostile => candidate.Allegiance == MonsterAllegiance.Friendly,
            MonsterAllegiance.Friendly => candidate.Allegiance == MonsterAllegiance.Hostile,
            _ => false,
        };
    }
}
