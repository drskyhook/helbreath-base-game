using System.Collections.Generic;
using Mmorpg.Network;
using Server;
using Server.Utils;
using Server.World;
using Server.World.Game;

namespace Server.Helpers;

/// <summary>Temporary-effect spell resolution, apply rules, and shared break-invisibility helpers.</summary>
public static class TemporaryEffects {
    /// <summary>Returns false when any temporary effect in the same group is already active (caller should not apply or refresh).</summary>
    public static bool CanApplyTemporaryEffectInGroup(
        IReadOnlyDictionary<TemporaryEffectType, ActiveTemporaryEffectSlot> activeEffects,
        int group) {
        foreach (var kv in activeEffects) {
            if (kv.Value.Group == group) {
                return false;
            }
        }
        return true;
    }

    /// <summary>Applies on-hit temporary effects from <paramref name="spell"/> to <paramref name="target"/> after damage resolves.</summary>
    public static void ApplySpellTemporaryEffectsOnHit(GameWorldRef wr, SpellConfig spell, GameWorldActionableEntity target) {
        ArgumentNullException.ThrowIfNull(spell);
        ArgumentNullException.ThrowIfNull(target);
        if (spell.TemporaryEffects is not { Length: > 0 } rows) {
            return;
        }

        foreach (var row in rows) {
            var moveMod = row.MovementSpeedModifier ?? 0;
            var attackMod = row.AttackSpeedModifier ?? 0;
            var castMod = row.CastSpeedModifier ?? 0;
            if (target is GameWorldMonster) {
                castMod = 0;
            }

            target.ApplyTemporaryEffect(
                wr,
                (TemporaryEffectType)row.Type,
                row.Group,
                row.Duration,
                moveMod,
                attackMod,
                castMod);
        }
    }

    /// <summary>Resolves buff-only spell casts (occupant at cell, apply effects, fan-out cast visuals).</summary>
    public static void ResolveBuffSpellAtCell(
        GameWorldRef wr,
        GameWorldPlayer caster,
        SpellConfig spell,
        int targetX,
        int targetY) {
        ArgumentNullException.ThrowIfNull(caster);
        ArgumentNullException.ThrowIfNull(spell);
        if (spell.TemporaryEffects is not { Length: > 0 } rows) {
            return;
        }

        GameWorldPlayer? playerOnCell = null;
        foreach (var p in wr.PlayerSpatialGrid.GetPlayersInRectangle(targetX, targetY, targetX, targetY, excludeDisconnected: false)) {
            if (p.PosX == targetX && p.PosY == targetY && !p.IsDead) {
                playerOnCell = p;
                break;
            }
        }

        if (playerOnCell is not null) {
            foreach (var row in rows) {
                playerOnCell.ApplyTemporaryEffect(
                    wr,
                    (TemporaryEffectType)row.Type,
                    row.Group,
                    row.Duration,
                    row.MovementSpeedModifier ?? 0,
                    row.AttackSpeedModifier ?? 0,
                    row.CastSpeedModifier ?? 0);
            }
            return;
        }

        GameWorldMonster? monsterOnCell = null;
        foreach (var m in wr.MonsterSpatialGrid.GetMonstersInRectangle(targetX, targetY, targetX, targetY)) {
            if (m.PosX == targetX && m.PosY == targetY && !m.Dead) {
                monsterOnCell = m;
                break;
            }
        }

        if (monsterOnCell is not null) {
            foreach (var row in rows) {
                monsterOnCell.ApplyTemporaryEffect(
                    wr,
                    (TemporaryEffectType)row.Type,
                    row.Group,
                    row.Duration,
                    row.MovementSpeedModifier ?? 0,
                    row.AttackSpeedModifier ?? 0,
                    0);
            }
        }
    }

    /// <summary>Removes invisibility from the entity when they begin or complete a spell cast, attack, etc.</summary>
    public static void BreakInvisibilityIfPresent(GameWorldRef wr, GameWorldActionableEntity entity) {
        ArgumentNullException.ThrowIfNull(entity);
        if (entity.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            entity.RemoveTemporaryEffect(wr, TemporaryEffectType.Invisibility, broadcastExpired: true);
        }
    }
}
