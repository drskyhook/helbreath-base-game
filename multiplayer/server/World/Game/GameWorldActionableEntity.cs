using System.Collections.Generic;
using Google.Protobuf.Collections;
using Mmorpg.Network;
using Server.Helpers;
using Server.Utils;
using Server.World;

namespace Server.World.Game;

/// <summary>
/// Player and monster entities that participate in timed temporary effects (buffs/debuffs) and related network broadcasts.
/// </summary>
public abstract class GameWorldActionableEntity : GameWorldEntity {
    protected readonly Dictionary<TemporaryEffectType, ActiveTemporaryEffectSlot> activeTemporaryEffects = new();

    /// <summary>Sum of <see cref="ActiveTemporaryEffectSlot.MovementSpeedModifier"/> across active effects.</summary>
    protected double temporaryEffectMovementSpeedModifierSum;

    /// <summary>Sum of <see cref="ActiveTemporaryEffectSlot.AttackSpeedModifier"/> across active effects.</summary>
    protected double temporaryEffectAttackSpeedModifierSum;

    /// <summary>Sum of <see cref="ActiveTemporaryEffectSlot.CastSpeedModifier"/> across active effects (players only).</summary>
    protected double temporaryEffectCastSpeedModifierSum;

    protected abstract TemporaryEffectEntityKind EntityKind { get; }
    protected abstract long EntityId { get; }

    /// <summary>True when this entity has the given temporary effect (authoritative).</summary>
    public bool HasTemporaryEffect(TemporaryEffectType effectType) {
        return activeTemporaryEffects.ContainsKey(effectType);
    }

    /// <summary>Applies a temporary effect when no effect in the same <paramref name="group"/> is already active; otherwise no-op (no refresh).</summary>
    /// <remarks>Modifiers are additive to 1 for duration: effective ms = base / (1 + sum).</remarks>
    public void ApplyTemporaryEffect(
        GameWorldRef wr,
        TemporaryEffectType effectType,
        int group,
        int durationMs,
        double movementSpeedModifier,
        double attackSpeedModifier,
        double castSpeedModifier) {
        if (!TemporaryEffects.CanApplyTemporaryEffectInGroup(activeTemporaryEffects, group)) {
            return;
        }

        var timerId = 0;
        timerId = wr.Scheduler.SetTimeout(durationMs, () => OnTemporaryEffectTimerExpired(wr, effectType, timerId));
        activeTemporaryEffects[effectType] = new ActiveTemporaryEffectSlot {
            Group = group,
            ExpiryTimerId = timerId,
            MovementSpeedModifier = movementSpeedModifier,
            AttackSpeedModifier = attackSpeedModifier,
            CastSpeedModifier = castSpeedModifier,
        };
        RecalculateTemporaryEffectSpeedSums();
        BroadcastTemporaryEffectApplied(wr, effectType);
    }

    /// <summary>Re-sums modifiers from <see cref="activeTemporaryEffects"/>; <see cref="GameWorldMonster"/> omits cast.</summary>
    protected virtual void RecalculateTemporaryEffectSpeedSums() {
        double m = 0, a = 0, c = 0;
        foreach (var kv in activeTemporaryEffects) {
            m += kv.Value.MovementSpeedModifier;
            a += kv.Value.AttackSpeedModifier;
            c += kv.Value.CastSpeedModifier;
        }

        temporaryEffectMovementSpeedModifierSum = m;
        temporaryEffectAttackSpeedModifierSum = a;
        temporaryEffectCastSpeedModifierSum = c;
    }

    /// <summary>Removes a temporary effect and cancels its expiry timer; optionally notifies viewers.</summary>
    public void RemoveTemporaryEffect(GameWorldRef wr, TemporaryEffectType effectType, bool broadcastExpired) {
        if (!activeTemporaryEffects.TryGetValue(effectType, out var slot)) {
            return;
        }

        wr.Scheduler.ClearTimeout(slot.ExpiryTimerId);
        activeTemporaryEffects.Remove(effectType);
        RecalculateTemporaryEffectSpeedSums();
        if (broadcastExpired) {
            BroadcastTemporaryEffectExpired(wr, effectType);
        }
    }

    /// <summary>Cancels all temporary-effect timers and clears state; emits expire for each (e.g. on death).</summary>
    public void ClearAllTemporaryEffects(GameWorldRef wr) {
        if (activeTemporaryEffects.Count == 0) {
            return;
        }

        var types = new TemporaryEffectType[activeTemporaryEffects.Count];
        activeTemporaryEffects.Keys.CopyTo(types, 0);
        foreach (var et in types) {
            RemoveTemporaryEffect(wr, et, broadcastExpired: true);
        }
    }

    /// <summary>Copies active temporary-effect keys into a protobuf repeated field (visibility snapshots).</summary>
    protected void CopyActiveTemporaryEffectTypesTo(RepeatedField<TemporaryEffectType> dest) {
        ArgumentNullException.ThrowIfNull(dest);
        dest.Clear();
        foreach (var kv in activeTemporaryEffects) {
            dest.Add(kv.Key);
        }
    }

    private void OnTemporaryEffectTimerExpired(GameWorldRef wr, TemporaryEffectType effectType, int expectedTimerId) {
        if (!activeTemporaryEffects.TryGetValue(effectType, out var slot) || slot.ExpiryTimerId != expectedTimerId) {
            return;
        }

        activeTemporaryEffects.Remove(effectType);
        RecalculateTemporaryEffectSpeedSums();
        BroadcastTemporaryEffectExpired(wr, effectType);
    }

    /// <summary>Effective movement/attack/cast ms after debuffs for network payloads.</summary>
    protected abstract int GetEffectiveMovementSpeedMsForBroadcast();

    protected abstract int GetEffectiveAttackSpeedMsForBroadcast();

    protected abstract int? GetEffectiveCastSpeedMsForBroadcast();

    private void BroadcastTemporaryEffectApplied(GameWorldRef wr, TemporaryEffectType effectType) {
        var message = NetworkManager.CreateTemporaryEffectApplied(
            EntityKind,
            EntityId,
            effectType,
            GetEffectiveMovementSpeedMsForBroadcast(),
            GetEffectiveAttackSpeedMsForBroadcast(),
            GetEffectiveCastSpeedMsForBroadcast());
        foreach (var recipient in wr.PlayerSpatialGrid.GetNearbyPlayers(PosX, PosY, excludeDisconnected: true)) {
            NetworkManager.SendToPlayer(recipient, message);
        }
    }

    private void BroadcastTemporaryEffectExpired(GameWorldRef wr, TemporaryEffectType effectType) {
        var message = NetworkManager.CreateTemporaryEffectExpired(
            EntityKind,
            EntityId,
            effectType,
            GetEffectiveMovementSpeedMsForBroadcast(),
            GetEffectiveAttackSpeedMsForBroadcast(),
            GetEffectiveCastSpeedMsForBroadcast());
        foreach (var recipient in wr.PlayerSpatialGrid.GetNearbyPlayers(PosX, PosY, excludeDisconnected: true)) {
            NetworkManager.SendToPlayer(recipient, message);
        }
    }
}
