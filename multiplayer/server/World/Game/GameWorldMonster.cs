using System.Collections.Generic;
using Mmorpg.Network;
using Server;
using Server.Helpers;
using Server.Utils;
using Server.World;

namespace Server.World.Game;

/// <summary>Inclusive axis-aligned rectangle in world tiles constraining random wander targets.</summary>
public readonly record struct MonsterDwellArea(int X1, int Y1, int X2, int Y2);

/// <summary>
/// Server-authoritative monster instance on a map: catalog display name, sprite id, grid cell, authoritative facing (0–7),
/// lifecycle/move state,
/// optional wander AI within a dwell rectangle (random rest on arrival between configured min/max ms), optional chase toward a targeted player or monster while they remain valid and within optional max follow distance (damage aggro ignores max follow for the attacker), and allegiance-controlled auto-aggro (hostile auto-targets nearby players first, then friendly monsters; friendly auto-targets hostile monsters; neutral only retaliates after being hit),
/// melee attack when the chase target is within Chebyshev <see cref="AttackRangeCells"/> (damage delivery allows up to <see cref="AttackRangeCells"/> + 1, matching player hit validation),
/// and per-step movement pacing for client sync. Player weapon damage reduces <see cref="Hp"/>; at 0 HP the monster becomes <see cref="Dead"/>,
/// stops AI, releases grid occupancy at the death cell immediately (corpse is visual-only), and is removed after <see cref="CorpseDecayDurationMs"/> linger.
/// </summary>
public class GameWorldMonster : GameWorldActionableEntity {
    public enum CombatTargetKind {
        None = 0,
        Player = 1,
        Monster = 2,
    }

    /// <summary>Player ids that currently have this monster in their view radius (for movement fan-out).</summary>
    private readonly HashSet<long> playersInRange = new();

    private int finalDestX = -1;
    private int finalDestY = -1;
    private DateTimeOffset movementDestinationDue;
    private CombatTargetKind combatTargetKind;
    private long? combatTargetId;
    /// <summary>When set, <see cref="MonsterEntityState.Attack"/> ends at this time; cleared when not attacking.</summary>
    private DateTimeOffset? attackAnimationEndDue;
    /// <summary>When set, damage resolves when <see cref="GameWorldMonster.TickAi"/> time reaches this value (half of attack animation).</summary>
    private DateTimeOffset? attackDamageDealDue;
    /// <summary>Prevents applying damage twice in one swing if ticks are coarse.</summary>
    private bool attackDamageDealtThisSwing;
    /// <summary>While set and <c>now</c> is before this instant, <see cref="TickAi"/> skips idle/move decisions (attack animation still runs). Set after melee damage (recovery + half attack), after reaching a wander destination (random rest in <see cref="MinIdleTimeMs"/>..<see cref="MaxIdleTimeMs"/>), and reserved for future gating.</summary>
    private DateTimeOffset? stayInIdleUntil;

    /// <summary>While set and <c>now</c> is before this instant, <see cref="TickAi"/> skips all AI (stunlock). Not extended by a new stunlock until elapsed.</summary>
    private DateTimeOffset? stunlockUntil;

    /// <summary>When set to the current combat target, ongoing chase ignores <see cref="ChaseMaxDistanceCells"/> until cleared (the attacker damaged this monster).</summary>
    private CombatTargetKind damageAggroTargetKind;
    private long? damageAggroTargetId;

    /// <summary>Distinguishes wander rest (chase may preempt) from post-damage recovery (<see cref="TryEndStayInIdleForChasePrecedence"/> must not clear).</summary>
    private enum IdleGateKind {
        None,
        WanderRest,
        AttackRecovery,
    }

    private IdleGateKind idleGateKind;

    private int hp;
    private int maxHp;
    /// <summary>When true, AI and incoming player damage are ignored; <see cref="CorpseDecayUntil"/> governs removal.</summary>
    private bool dead;
    /// <summary>Wall-clock instant after which the world removes this corpse.</summary>
    private DateTimeOffset? corpseDecayUntil;

    public Guid MonsterGuid { get; }
    public long MonsterId { get; }

    protected override TemporaryEffectEntityKind EntityKind => TemporaryEffectEntityKind.Monster;
    protected override long EntityId => MonsterId;

    public string Name { get; }
    public string Sprite { get; }
    public MonsterEntityState State { get; private set; }
    private readonly int baseMovementSpeedMs;
    private readonly int baseAttackSpeedMs;

    /// <summary>Authoritative milliseconds per movement step when moving; 0 disables movement and wander while chase targeting and melee attacks (when a player is in range) still run.</summary>
    public int MovementSpeedMs {
        get {
            if (baseMovementSpeedMs <= 0) {
                return 0;
            }

            return Math.Max(
                1,
                TemporaryEffectSpeedModifierMath.ApplyModifierSumToDurationMs(
                    baseMovementSpeedMs,
                    temporaryEffectMovementSpeedModifierSum));
        }
    }
    /// <summary>Chebyshev cell distance: a visible player within this distance can start chase. Resolved at spawn from <c>Monsters.json</c> and <c>monsterDefaults.chaseDistance</c> when the catalog omits <c>chaseDistance</c>.</summary>
    public int ChaseDistanceCells { get; }
    /// <summary>When set, chase is abandoned if Chebyshev distance from this monster to the target exceeds this value (cells). Resolved at spawn from <c>Monsters.json</c> and optional <c>monsterDefaults.chaseMaxDistance</c> when the catalog omits <c>chaseMaxDistance</c>.</summary>
    public int? ChaseMaxDistanceCells { get; }
    /// <summary>Chebyshev cells: when a chase target is at or within this distance, the monster attacks instead of stepping closer. Default 1 when omitted in catalog.</summary>
    public int AttackRangeCells { get; }
    /// <summary>Full attack animation duration in ms (client sync). From catalog <c>attackSpeed</c> or <c>monsterDefaults.attackSpeed</c>, with temporary-effect modifiers.</summary>
    public int AttackSpeedMs =>
        Math.Max(
            1,
            TemporaryEffectSpeedModifierMath.ApplyModifierSumToDurationMs(
                baseAttackSpeedMs,
                temporaryEffectAttackSpeedModifierSum));
    /// <summary>Inclusive lower bound for damage roll; catalog or <c>monsterDefaults.attackDamageMin</c>.</summary>
    public int AttackDamageMin { get; }
    /// <summary>Inclusive upper bound for damage roll; catalog or <c>monsterDefaults.attackDamageMax</c>.</summary>
    public int AttackDamageMax { get; }
    /// <summary>Milliseconds added with half of <see cref="AttackSpeedMs"/> to the idle gate after damage is dealt; catalog or <c>monsterDefaults.attackRecoveryTime</c>.</summary>
    public int AttackRecoveryMs { get; }
    /// <summary>Inclusive ms bounds for random rest after arriving at a wander target; catalog or <c>monsterDefaults.minIdleTime</c> / <c>monsterDefaults.maxIdleTime</c>.</summary>
    public int MinIdleTimeMs { get; }
    /// <summary>Inclusive upper bound for wander rest; see <see cref="MinIdleTimeMs"/>.</summary>
    public int MaxIdleTimeMs { get; }
    public MonsterDwellArea DwellArea { get; }
    /// <summary>True when spawned from a world's <c>dwellAreas</c> in GameWorlds.json; false for summons (e.g. MonsterDialog) and any spawn not tied to configured dwell areas.</summary>
    public bool HasDwellArea { get; }
    /// <summary>Current combat target kind for AI chase/attack decisions.</summary>
    public CombatTargetKind TargetKind => combatTargetKind;

    /// <summary>Current combat target id when <see cref="TargetKind"/> is not <see cref="CombatTargetKind.None"/>.</summary>
    public long? TargetId => combatTargetId;

    /// <summary>When set, movement prefers pathing toward this player while they remain in <see cref="playersInRange"/> and within <see cref="ChaseMaxDistanceCells"/> when it is set (unless damage aggro applies).</summary>
    public long? TargetedPlayerId => combatTargetKind == CombatTargetKind.Player ? combatTargetId : null;

    /// <summary>When set, movement prefers pathing toward this monster while it remains valid and within chase constraints.</summary>
    public long? TargetedMonsterId => combatTargetKind == CombatTargetKind.Monster ? combatTargetId : null;

    /// <summary>Whether melee hits send damage/interrupt fields on <see cref="Mmorpg.Network.PlayerReceiveDamage"/>; from catalog <c>attackType</c> or <see cref="AttackType.NoInterrupt"/>.</summary>
    public AttackType AttackType { get; }

    /// <summary>Hostile monsters auto-target nearby players; neutral monsters only chase after taking damage from a player.</summary>
    public MonsterAllegiance Allegiance { get; }

    /// <summary>Player stunlock duration in ms when <see cref="AttackType"/> is <see cref="AttackType.Stun"/>; not applied when <see cref="AttackType"/> is <see cref="AttackType.Interrupt"/>. From catalog <c>attackStunDuration</c> or 100.</summary>
    public int StunDurationMs { get; }

    /// <summary>When true, player damage is delayed by half swing plus Euclidean arrow time at <see cref="TimingsConfig.ArrowSpeed"/> (<c>timings.arrowSpeed</c>); catalog <c>rangedAttack</c>.</summary>
    public bool RangedAttack { get; }

    public IReadOnlyCollection<long> PlayersInRange => playersInRange;

    /// <summary>Authoritative current HP (0 when <see cref="Dead"/>).</summary>
    public int Hp => hp;

    /// <summary>Max HP from catalog or settings default at spawn.</summary>
    public int MaxHp => maxHp;

    /// <summary>True after HP reaches 0 until world removal.</summary>
    public bool Dead => dead;

    /// <summary>Corpse linger duration (ms) from catalog or settings; sent on <c>monster_died</c>.</summary>
    public int CorpseDecayDurationMs { get; }

    /// <summary>When <see cref="Dead"/>, instant when the corpse is removed from the map.</summary>
    public DateTimeOffset? CorpseDecayUntil => corpseDecayUntil;

    /// <summary>Index into <c>Monsters.json</c> (<see cref="MonsterConfig.Id"/>); used to respawn dwell-spawned instances.</summary>
    public int CatalogMonsterId { get; }

    /// <summary>Catalog spell entries for AI casts (empty when the monster has no spells).</summary>
    public IReadOnlyList<MonsterSpellEntry> ConfiguredSpells => configuredSpells;

    private readonly MonsterSpellEntry[] configuredSpells;

    public GameWorldMonster(
        Guid monsterGuid,
        string name,
        string sprite,
        int posX,
        int posY,
        int movementSpeedMs,
        int chaseDistanceCells,
        int? chaseMaxDistanceCells,
        int attackRangeCells,
        int attackSpeedMs,
        int attackDamageMin,
        int attackDamageMax,
        int attackRecoveryMs,
        int minIdleTimeMs,
        int maxIdleTimeMs,
        MonsterDwellArea dwellArea,
        bool hasDwellArea,
        AttackType attackType,
        MonsterAllegiance allegiance,
        int stunDurationMs,
        bool rangedAttack = false,
        MonsterEntityState state = MonsterEntityState.Idle,
        int maxHpValue = 100,
        int corpseDecayDurationMs = 3000,
        int catalogMonsterId = 0,
        int initialFacingDirection = 4,
        MonsterSpellEntry[]? monsterSpells = null) {
        if (string.IsNullOrWhiteSpace(name)) {
            throw new ArgumentException("Monster name is required.", nameof(name));
        }
        if (string.IsNullOrWhiteSpace(sprite)) {
            throw new ArgumentException("Monster sprite is required.", nameof(sprite));
        }
        if (attackRangeCells < 0) {
            throw new ArgumentOutOfRangeException(nameof(attackRangeCells), "Attack range must be non-negative.");
        }
        if (attackSpeedMs <= 0) {
            throw new ArgumentOutOfRangeException(nameof(attackSpeedMs), "Attack speed must be positive.");
        }
        if (attackDamageMin > attackDamageMax) {
            throw new ArgumentOutOfRangeException(nameof(attackDamageMin), "Attack damage min must not exceed max.");
        }
        if (attackRecoveryMs < 0) {
            throw new ArgumentOutOfRangeException(nameof(attackRecoveryMs), "Attack recovery must be non-negative.");
        }
        if (minIdleTimeMs < 0) {
            throw new ArgumentOutOfRangeException(nameof(minIdleTimeMs), "Min idle time must be non-negative.");
        }
        if (maxIdleTimeMs < 0) {
            throw new ArgumentOutOfRangeException(nameof(maxIdleTimeMs), "Max idle time must be non-negative.");
        }
        if (minIdleTimeMs > maxIdleTimeMs) {
            throw new ArgumentOutOfRangeException(nameof(minIdleTimeMs), "Min idle time must not exceed max idle time.");
        }
        if (stunDurationMs < 0) {
            throw new ArgumentOutOfRangeException(nameof(stunDurationMs), "Stun duration must be non-negative.");
        }
        if (maxHpValue <= 0) {
            throw new ArgumentOutOfRangeException(nameof(maxHpValue), "Max HP must be positive.");
        }
        if (corpseDecayDurationMs <= 0) {
            throw new ArgumentOutOfRangeException(nameof(corpseDecayDurationMs), "Corpse decay duration must be positive.");
        }
        if (catalogMonsterId < 0) {
            throw new ArgumentOutOfRangeException(nameof(catalogMonsterId), "Catalog monster id must be non-negative.");
        }
        if (initialFacingDirection < 0 || initialFacingDirection > 7) {
            throw new ArgumentOutOfRangeException(nameof(initialFacingDirection), "Facing direction must be 0-7.");
        }

        MonsterGuid = monsterGuid;
        MonsterId = BitConverter.ToInt64(monsterGuid.ToByteArray(), 0);
        Name = name;
        Sprite = sprite;
        SetGridPosition(posX, posY);
        baseMovementSpeedMs = movementSpeedMs;
        ChaseDistanceCells = chaseDistanceCells;
        ChaseMaxDistanceCells = chaseMaxDistanceCells;
        AttackRangeCells = attackRangeCells;
        baseAttackSpeedMs = attackSpeedMs;
        AttackDamageMin = attackDamageMin;
        AttackDamageMax = attackDamageMax;
        AttackRecoveryMs = attackRecoveryMs;
        MinIdleTimeMs = minIdleTimeMs;
        MaxIdleTimeMs = maxIdleTimeMs;
        DwellArea = dwellArea;
        HasDwellArea = hasDwellArea;
        AttackType = attackType;
        Allegiance = allegiance;
        StunDurationMs = stunDurationMs;
        RangedAttack = rangedAttack;
        State = state;
        maxHp = maxHpValue;
        hp = maxHpValue;
        CorpseDecayDurationMs = corpseDecayDurationMs;
        CatalogMonsterId = catalogMonsterId;
        SetFacingDirection(initialFacingDirection);
        configuredSpells = monsterSpells is { Length: > 0 } s ? s : Array.Empty<MonsterSpellEntry>();
    }

    /// <summary>Ms remaining until corpse removal when <see cref="Dead"/>; otherwise 0.</summary>
    public int GetCorpseDecayTimeLeftMs(DateTimeOffset now) {
        if (!dead || !corpseDecayUntil.HasValue) {
            return 0;
        }

        var ms = (corpseDecayUntil.Value - now).TotalMilliseconds;
        return ms > 0 ? (int)Math.Ceiling(ms) : 0;
    }

    /// <summary>Authoritative hit from an attacker (e.g. player weapon); may be extended for other sources. Reduces HP and marks dead at 0; frees occupancy at the monster cell on death so walkers are not blocked by the corpse. Returns false if already dead.</summary>
    public bool TryApplyAttackerHit(GameWorldRef wr, int damage, DateTimeOffset now, out int hpAfter) {
        hpAfter = hp;
        if (dead) {
            return false;
        }

        hp = Math.Max(0, hp - damage);
        hpAfter = hp;
        if (hp != 0) {
            return true;
        }

        dead = true;
        wr.OccupancyTracker.SetFree(posX, posY);
        corpseDecayUntil = now.AddMilliseconds(CorpseDecayDurationMs);
        ClearChaseState();
        attackAnimationEndDue = null;
        attackDamageDealDue = null;
        attackDamageDealtThisSwing = false;
        stayInIdleUntil = null;
        idleGateKind = IdleGateKind.None;
        stunlockUntil = null;
        SetState(MonsterEntityState.Idle);
        return true;
    }

    public void SetState(MonsterEntityState value) {
        State = value;
    }

    /// <summary>Sets chase target when <see cref="MonsterChase"/> picks a new valid player target (existing target kept until invalid per chase rules).</summary>
    public void SetTargetedPlayer(long playerId) {
        SetCombatTarget(CombatTargetKind.Player, playerId);
    }

    /// <summary>Sets chase target when <see cref="MonsterChase"/> picks a new valid monster target (existing target kept until invalid per chase rules).</summary>
    public void SetTargetedMonster(long monsterId) {
        SetCombatTarget(CombatTargetKind.Monster, monsterId);
    }

    /// <summary>After a player deals damage: hostile/neutral monsters switch chase to that player and ignore max follow distance until chase clears or target changes. Friendly monsters never target players.</summary>
    public void SetAggroFromDamagePlayerAttacker(long attackerPlayerId) {
        if (dead || Allegiance == MonsterAllegiance.Friendly) {
            return;
        }

        SetDamageAggroTarget(CombatTargetKind.Player, attackerPlayerId);
    }

    /// <summary>After a monster deals damage: usually switch chase to that monster and ignore max follow distance until chase clears or target changes. Non-friendly monsters keep an existing player target when the attacker is friendly or neutral. Same-allegiance attackers do not provoke damage aggro.</summary>
    public void SetAggroFromDamageMonsterAttacker(long attackerMonsterId, MonsterAllegiance attackerAllegiance) {
        if (dead || attackerMonsterId == MonsterId) {
            return;
        }

        if (Allegiance == attackerAllegiance) {
            return;
        }

        if (Allegiance != MonsterAllegiance.Friendly &&
            combatTargetKind == CombatTargetKind.Player &&
            combatTargetId.HasValue &&
            (attackerAllegiance == MonsterAllegiance.Friendly || attackerAllegiance == MonsterAllegiance.Neutral)) {
            return;
        }

        SetDamageAggroTarget(CombatTargetKind.Monster, attackerMonsterId);
    }

    /// <summary>Whether <paramref name="currentTarget"/> is still valid as the ongoing chase target (includes damage-aggro max-distance bypass).</summary>
    public bool IsOngoingChaseTargetStillValid(GameWorldPlayer currentTarget) {
        if (currentTarget.IsDead || currentTarget.SpawnProtection) {
            return false;
        }

        return !ExceedsNonAggroChaseMaxDistance(CombatTargetKind.Player, currentTarget.PlayerId, currentTarget.PosX, currentTarget.PosY);
    }

    /// <summary>Whether <paramref name="currentTarget"/> is still valid as the ongoing chase target (includes damage-aggro max-distance bypass).</summary>
    public bool IsOngoingChaseTargetStillValid(GameWorldMonster currentTarget, SettingsConfig settings) {
        if (currentTarget.Dead || currentTarget.MonsterId == MonsterId) {
            return false;
        }

        if (Math.Abs(currentTarget.PosX - posX) > settings.Radius.ViewRadiusX || Math.Abs(currentTarget.PosY - posY) > settings.Radius.ViewRadiusY) {
            return false;
        }

        return !ExceedsNonAggroChaseMaxDistance(CombatTargetKind.Monster, currentTarget.MonsterId, currentTarget.PosX, currentTarget.PosY);
    }

    private void SetCombatTarget(CombatTargetKind targetKind, long targetId) {
        if (combatTargetKind == targetKind && combatTargetId == targetId) {
            return;
        }

        if (IsDamageAggroTargetActive() && (damageAggroTargetKind != targetKind || damageAggroTargetId != targetId)) {
            damageAggroTargetKind = CombatTargetKind.None;
            damageAggroTargetId = null;
        }

        combatTargetKind = targetKind;
        combatTargetId = targetId;
    }

    private void SetDamageAggroTarget(CombatTargetKind targetKind, long targetId) {
        combatTargetKind = targetKind;
        combatTargetId = targetId;
        damageAggroTargetKind = targetKind;
        damageAggroTargetId = targetId;
        CancelCurrentAttackForRetarget();
    }

    private bool IsDamageAggroTargetActive() {
        return damageAggroTargetKind != CombatTargetKind.None && damageAggroTargetId.HasValue;
    }

    private bool ExceedsNonAggroChaseMaxDistance(CombatTargetKind targetKind, long targetId, int targetX, int targetY) {
        if (ChaseMaxDistanceCells is not int maxD) {
            return false;
        }

        if (IsDamageAggroTargetActive() && damageAggroTargetKind == targetKind && damageAggroTargetId == targetId) {
            return false;
        }

        return Location.GetDistance(posX, posY, targetX, targetY) > maxD;
    }

    private void CancelCurrentAttackForRetarget() {
        if (State != MonsterEntityState.Attack) {
            return;
        }

        attackAnimationEndDue = null;
        attackDamageDealDue = null;
        attackDamageDealtThisSwing = false;
        SetState(MonsterEntityState.Idle);
        if (idleGateKind == IdleGateKind.AttackRecovery) {
            stayInIdleUntil = null;
            idleGateKind = IdleGateKind.None;
        }
    }

    /// <summary>Clears wander <see cref="stayInIdleUntil"/> when a chase target is valid so random rest does not delay pursuit. Post-attack recovery is not cleared.</summary>
    private void TryEndStayInIdleForChasePrecedence(GameWorldRef wr) {
        if (idleGateKind != IdleGateKind.WanderRest || !stayInIdleUntil.HasValue) {
            return;
        }

        MonsterChase.EvaluateChaseForMonster(wr, this);
        if (combatTargetKind != CombatTargetKind.None && combatTargetId.HasValue && TryResolveChaseDestination(wr, out _, out _)) {
            stayInIdleUntil = null;
            idleGateKind = IdleGateKind.None;
        }
    }

    /// <summary>Clears the scheduled damage instant for the current attack swing (player hit with <see cref="Server.AttackType.Interrupt"/>); applies to melee and ranged monster attacks. The attack animation continues until its configured end time.</summary>
    public void ClearPendingAttackDamageFromPlayerInterrupt() {
        attackDamageDealDue = null;
    }

    /// <summary>Applies stunlock until <paramref name="durationMs"/> elapses from <paramref name="now"/>. Returns false if a stunlock is already active (no refresh) to avoid chain-stunlock.</summary>
    public bool TryApplyStunlock(DateTimeOffset now, int durationMs) {
        if (dead) {
            return false;
        }
        if (durationMs <= 0) {
            return false;
        }

        if (stunlockUntil.HasValue && now < stunlockUntil.Value) {
            return false;
        }

        stunlockUntil = now.AddMilliseconds(durationMs);
        return true;
    }

    /// <summary>Moves this monster one cell away from <paramref name="attackerPosX"/>, <paramref name="attackerPosY"/> when that cell is free (knockback from an attacker hit). Updates occupancy, spatial grid, and visibility. Returns false when direction is invalid or the destination is blocked.</summary>
    public bool TryApplyKnockbackFromAttacker(GameWorldRef wr, int attackerPosX, int attackerPosY, out int destX, out int destY) {
        destX = -1;
        destY = -1;
        if (dead) {
            return false;
        }
        var dir = Location.GetNextGridDirection(attackerPosX, attackerPosY, posX, posY);
        if (dir < 0 || dir > 7) {
            return false;
        }

        Location.GetDirectionDelta(dir, out var kdx, out var kdy);
        var kx = posX + kdx;
        var ky = posY + kdy;
        if (!wr.OccupancyTracker.IsFreeAndNotTeleportCell(kx, ky)) {
            return false;
        }

        var prevX = posX;
        var prevY = posY;
        wr.OccupancyTracker.SetFree(prevX, prevY);
        wr.OccupancyTracker.SetOccupied(kx, ky);
        wr.MonsterSpatialGrid.Move(this, kx, ky);
        SetGridPosition(kx, ky);
        destX = kx;
        destY = ky;
        SetFacingDirection(dir);
        MonsterVisibility.SyncMonsterVisibilityAfterMonsterStep(wr, this, prevX, prevY, kx, ky);
        Combat.ApplyGroundEffectStepDamageToMonster(wr, this);
        return true;
    }

    /// <summary>Advances wander/chase AI on the world worker thread: idle picks a path leg when viewers exist (or no dwell gate); move waits until the step deadline then advances; attack resolves damage at half animation and returns to idle when the swing ends. When <see cref="MovementSpeedMs"/> is 0, skips movement and wander but still runs attack resolution and melee when a chase target is in range.</summary>
    public void TickAi(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (dead) {
            if (corpseDecayUntil.HasValue && now >= corpseDecayUntil.Value) {
                wr.World.RemoveMonster(this);
            }
            return;
        }

        if (stunlockUntil.HasValue && now >= stunlockUntil.Value) {
            stunlockUntil = null;
        }

        if (stunlockUntil.HasValue && now < stunlockUntil.Value) {
            return;
        }

        if (MovementSpeedMs <= 0) {
            TickStationaryAi(wr, random, now);
            return;
        }

        if (stayInIdleUntil.HasValue && now >= stayInIdleUntil.Value) {
            stayInIdleUntil = null;
            idleGateKind = IdleGateKind.None;
        }

        if (State != MonsterEntityState.Attack &&
            stayInIdleUntil.HasValue &&
            now < stayInIdleUntil.Value) {
            TryEndStayInIdleForChasePrecedence(wr);
        }

        if (State == MonsterEntityState.Attack) {
            ProcessAttackState(wr, random, now);
            return;
        }

        if (State == MonsterEntityState.Idle && stayInIdleUntil.HasValue && now < stayInIdleUntil.Value) {
            return;
        }

        if (State == MonsterEntityState.Move && now < movementDestinationDue) {
            return;
        }

        if (State == MonsterEntityState.Move) {
            ContinueMovementAfterStep(wr, random, now);
            return;
        }

        StartMovementFromIdle(wr, random, now);
    }

    /// <summary>Same idle/attack gates as full AI without wander or grid steps: tries melee when a valid chase target is in range; clears an invalid target.</summary>
    private void TickStationaryAi(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (stayInIdleUntil.HasValue && now >= stayInIdleUntil.Value) {
            stayInIdleUntil = null;
            idleGateKind = IdleGateKind.None;
        }

        if (State != MonsterEntityState.Attack &&
            stayInIdleUntil.HasValue &&
            now < stayInIdleUntil.Value) {
            TryEndStayInIdleForChasePrecedence(wr);
        }

        if (State == MonsterEntityState.Attack) {
            ProcessAttackState(wr, random, now);
            return;
        }

        if (State == MonsterEntityState.Idle && stayInIdleUntil.HasValue && now < stayInIdleUntil.Value) {
            return;
        }

        if (State == MonsterEntityState.Move) {
            SetState(MonsterEntityState.Idle);
        }

        StartMovementFromIdle(wr, random, now);
    }

    private void ProcessAttackState(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (attackDamageDealDue.HasValue && now >= attackDamageDealDue.Value && !attackDamageDealtThisSwing) {
            attackDamageDealtThisSwing = true;
            TryDealAttackDamage(wr, random, now);
        }

        if (attackAnimationEndDue.HasValue && now >= attackAnimationEndDue.Value) {
            attackAnimationEndDue = null;
            attackDamageDealDue = null;
            attackDamageDealtThisSwing = false;
            SetState(MonsterEntityState.Idle);
            if (stayInIdleUntil.HasValue && now < stayInIdleUntil.Value) {
                return;
            }

            StartMovementFromIdle(wr, random, now);
        }
    }

    private void TryDealAttackDamage(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (!combatTargetId.HasValue || combatTargetKind == CombatTargetKind.None) {
            return;
        }

        if (combatTargetKind == CombatTargetKind.Player) {
            if (!TryDealDamageToPlayerTarget(wr, random, now, combatTargetId.Value)) {
                StopChasingPlayerIfTarget(combatTargetId.Value);
            }
            return;
        }

        if (!TryDealDamageToMonsterTarget(wr, random, now, combatTargetId.Value)) {
            StopChasingMonsterIfTarget(combatTargetId.Value);
        }
    }

    private void BeginAttack(GameWorldRef wr, DateTimeOffset now, int direction) {
        TemporaryEffects.BreakInvisibilityIfPresent(wr, this);
        SetFacingDirection(direction);
        SetState(MonsterEntityState.Attack);
        attackAnimationEndDue = now.AddMilliseconds(AttackSpeedMs);
        var halfMs = AttackSpeedMs / 2;
        if (RangedAttack && TryGetCurrentAttackTargetPosition(wr, out var targetX, out var targetY)) {
            halfMs += Projectile.ComputeTravelTime(posX, posY, targetX, targetY, wr.Settings.Timings.ArrowSpeed);
        }
        attackDamageDealDue = now.AddMilliseconds(halfMs);
        attackDamageDealtThisSwing = false;
        if (combatTargetKind == CombatTargetKind.Player) {
            MonsterVisibility.BroadcastMonsterAttacked(wr, this, direction, AttackSpeedMs, RangedAttack, combatTargetId ?? 0L);
            return;
        }

        if (combatTargetKind == CombatTargetKind.Monster && combatTargetId.HasValue) {
            MonsterVisibility.BroadcastMonsterAttackedMonster(wr, this, direction, AttackSpeedMs, RangedAttack, combatTargetId.Value);
        }
    }

    private bool TryDealDamageToPlayerTarget(GameWorldRef wr, Random random, DateTimeOffset now, long playerId) {
        if (!playersInRange.Contains(playerId) || !wr.World.TryGetConnectedPlayerById(playerId, out var p)) {
            return false;
        }

        if (p.IsDead || p.SpawnProtection || Location.GetDistance(posX, posY, p.PosX, p.PosY) > AttackRangeCells + 1) {
            return false;
        }

        if (p.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        var dmg = random.Next(AttackDamageMin, AttackDamageMax + 1);
        var px = p.PosX;
        var py = p.PosY;
        var attackTypeOut = AttackType;
        var stunPacketMs = 0;
        var knockbackDurMs = 0;
        var destKbX = -1;
        var destKbY = -1;

        var remainingStunlock = p.GetRemainingCombatStunlockMs(now);
        if ((AttackType == AttackType.Stun || AttackType == AttackType.Knockback) && remainingStunlock > 0) {
            attackTypeOut = AttackType.Interrupt;
        } else if (AttackType == AttackType.Stun) {
            stunPacketMs = StunDurationMs;
        } else if (AttackType == AttackType.Knockback) {
            stunPacketMs = StunDurationMs;
            var dir = Location.GetNextGridDirection(posX, posY, px, py);
            if (dir < 0 || dir > 7) {
                attackTypeOut = AttackType.Stun;
            } else {
                Location.GetDirectionDelta(dir, out var kdx, out var kdy);
                var kx = px + kdx;
                var ky = py + kdy;
                if (wr.OccupancyTracker.IsFreeAndNotTeleportCell(kx, ky)) {
                    wr.OccupancyTracker.SetFree(px, py);
                    wr.OccupancyTracker.SetOccupied(kx, ky);
                    Movement.SetPlayerPosition(wr, p, kx, ky);
                    Movement.SyncPlayerVisibilityAfterMovement(wr, p, px, py, kx, ky, broadcastPlayerMoved: false);
                    Combat.ApplyGroundEffectStepDamageToPlayer(wr, p);
                    knockbackDurMs = wr.Settings.Timings.KnockbackTimeMs;
                    destKbX = kx;
                    destKbY = ky;
                } else {
                    attackTypeOut = AttackType.Stun;
                }
            }
        }

        MonsterVisibility.BroadcastPlayerReceiveDamage(
            wr,
            p.PlayerId,
            dmg,
            MonsterId,
            attackTypeOut,
            stunPacketMs,
            knockbackDurMs,
            destKbX,
            destKbY,
            knockbackDurMs > 0 ? px : null,
            knockbackDurMs > 0 ? py : null);
        stayInIdleUntil = now.AddMilliseconds(AttackRecoveryMs + AttackSpeedMs / 2);
        idleGateKind = IdleGateKind.AttackRecovery;
        return true;
    }

    private bool TryDealDamageToMonsterTarget(GameWorldRef wr, Random random, DateTimeOffset now, long targetMonsterId) {
        if (!wr.World.TryGetMonsterByMonsterId(targetMonsterId, out var targetMonster) ||
            targetMonster.Dead ||
            targetMonster.MonsterId == MonsterId ||
            Location.GetDistance(posX, posY, targetMonster.PosX, targetMonster.PosY) > AttackRangeCells + 1) {
            return false;
        }

        if (targetMonster.HasTemporaryEffect(TemporaryEffectType.Invisibility)) {
            return false;
        }

        Combat.ApplyMonsterAttackToMonster(wr, this, targetMonster, random.Next(AttackDamageMin, AttackDamageMax + 1));
        stayInIdleUntil = now.AddMilliseconds(AttackRecoveryMs + AttackSpeedMs / 2);
        idleGateKind = IdleGateKind.AttackRecovery;
        return true;
    }

    private bool TryGetCurrentAttackTargetPosition(GameWorldRef wr, out int targetX, out int targetY) {
        targetX = -1;
        targetY = -1;
        if (!combatTargetId.HasValue || combatTargetKind == CombatTargetKind.None) {
            return false;
        }

        if (combatTargetKind == CombatTargetKind.Player) {
            var playerId = combatTargetId.Value;
            if (!playersInRange.Contains(playerId) || !wr.World.TryGetConnectedPlayerById(playerId, out var player) || player.SpawnProtection) {
                return false;
            }

            targetX = player.PosX;
            targetY = player.PosY;
            return true;
        }

        if (!wr.World.TryGetMonsterByMonsterId(combatTargetId.Value, out var monster) || monster.Dead || monster.MonsterId == MonsterId) {
            return false;
        }

        targetX = monster.PosX;
        targetY = monster.PosY;
        return true;
    }

    private bool IsAttackRecoveryBlocking(DateTimeOffset now) {
        return stayInIdleUntil.HasValue && now < stayInIdleUntil.Value && idleGateKind == IdleGateKind.AttackRecovery;
    }

    /// <summary>Resolves a catalog spell using per-entry cast probability; applies damage and recovery gate like a melee attack.</summary>
    private bool TryCastSpellAgainstChaseTarget(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (configuredSpells.Length == 0) {
            return false;
        }

        if (IsAttackRecoveryBlocking(now)) {
            return false;
        }

        if (combatTargetKind == CombatTargetKind.None || !combatTargetId.HasValue) {
            return false;
        }

        if (!TryGetCurrentAttackTargetPosition(wr, out var targetX, out var targetY)) {
            return false;
        }

        var settings = wr.Settings;
        if (Math.Abs(targetX - posX) > settings.Radius.CameraRadiusX || Math.Abs(targetY - posY) > settings.Radius.CameraRadiusY) {
            return false;
        }

        var candidates = new List<MonsterSpellEntry>();
        foreach (var entry in configuredSpells) {
            if (random.NextDouble() <= entry.CastProbability) {
                candidates.Add(entry);
            }
        }

        if (candidates.Count == 0) {
            return false;
        }

        var picked = candidates[random.Next(candidates.Count)];
        if (!wr.SpellsById.TryGetValue(picked.SpellId, out var spell)) {
            return false;
        }

        TemporaryEffects.BreakInvisibilityIfPresent(wr, this);
        var dmg = random.Next(AttackDamageMin, AttackDamageMax + 1);
        BeginSpellCastAttackSync(wr, now, targetX, targetY);
        Casting.ApplyMonsterSpell(wr, this, spell, targetX, targetY, dmg);
        stayInIdleUntil = now.AddMilliseconds(AttackRecoveryMs + AttackSpeedMs / 2);
        idleGateKind = IdleGateKind.AttackRecovery;
        return true;
    }

    /// <summary>Enters <see cref="MonsterEntityState.Attack"/> and fans out <see cref="Mmorpg.Network.MonsterAttacked"/> like melee so clients stop movement and play the attack pose; does not schedule melee damage (spell applies separately).</summary>
    private void BeginSpellCastAttackSync(GameWorldRef wr, DateTimeOffset now, int targetX, int targetY) {
        var dir = Location.GetNextGridDirection(posX, posY, targetX, targetY);
        if (dir < 0 || dir > 7) {
            dir = FacingDirection;
        }

        SetFacingDirection(dir);
        finalDestX = -1;
        finalDestY = -1;
        SetState(MonsterEntityState.Attack);
        attackAnimationEndDue = now.AddMilliseconds(AttackSpeedMs);
        attackDamageDealDue = null;
        attackDamageDealtThisSwing = false;
        if (combatTargetKind == CombatTargetKind.Player) {
            MonsterVisibility.BroadcastMonsterAttacked(wr, this, dir, AttackSpeedMs, RangedAttack, combatTargetId ?? 0L);
            return;
        }

        if (combatTargetKind == CombatTargetKind.Monster && combatTargetId.HasValue) {
            MonsterVisibility.BroadcastMonsterAttackedMonster(wr, this, dir, AttackSpeedMs, RangedAttack, combatTargetId.Value);
        }
    }

    /// <summary>When chase target cell is within Chebyshev <see cref="AttackRangeCells"/>, faces them and enters <see cref="MonsterEntityState.Attack"/>.</summary>
    private bool TryBeginMeleeAttackAgainstChaseTarget(GameWorldRef wr, DateTimeOffset now, int targetX, int targetY) {
        if (IsAttackRecoveryBlocking(now)) {
            return false;
        }

        if (Location.GetDistance(posX, posY, targetX, targetY) > AttackRangeCells) {
            return false;
        }

        if (!TryGetCurrentAttackTargetPosition(wr, out var resolvedTargetX, out var resolvedTargetY) ||
            resolvedTargetX != targetX ||
            resolvedTargetY != targetY) {
            return false;
        }

        var dir = Location.GetNextGridDirection(posX, posY, resolvedTargetX, resolvedTargetY);
        if (dir < 0) {
            return false;
        }

        finalDestX = -1;
        finalDestY = -1;
        BeginAttack(wr, now, dir);
        return true;
    }

    /// <summary>Clears chase/attack state when <paramref name="playerId"/> was the current target (e.g. player died).</summary>
    public void StopChasingPlayerIfTarget(long playerId) {
        if (combatTargetKind == CombatTargetKind.Player && combatTargetId == playerId) {
            ClearChaseState();
        }
    }

    /// <summary>Clears chase/attack state when <paramref name="monsterId"/> was the current target.</summary>
    public void StopChasingMonsterIfTarget(long monsterId) {
        if (combatTargetKind == CombatTargetKind.Monster && combatTargetId == monsterId) {
            ClearChaseState();
        }
    }

    private void ClearChaseState() {
        combatTargetKind = CombatTargetKind.None;
        combatTargetId = null;
        damageAggroTargetKind = CombatTargetKind.None;
        damageAggroTargetId = null;
        finalDestX = -1;
        finalDestY = -1;
        attackAnimationEndDue = null;
        attackDamageDealDue = null;
        attackDamageDealtThisSwing = false;
        if (State == MonsterEntityState.Move || State == MonsterEntityState.Attack) {
            SetState(MonsterEntityState.Idle);
        }
    }

    private bool TryResolveChaseDestination(GameWorldRef wr, out int destX, out int destY) {
        destX = -1;
        destY = -1;
        if (!combatTargetId.HasValue || combatTargetKind == CombatTargetKind.None) {
            return false;
        }

        if (combatTargetKind == CombatTargetKind.Player) {
            var playerId = combatTargetId.Value;
            if (!playersInRange.Contains(playerId) || !wr.World.TryGetConnectedPlayerById(playerId, out var player) || player.SpawnProtection) {
                return false;
            }

            destX = player.PosX;
            destY = player.PosY;
            return !ExceedsNonAggroChaseMaxDistance(CombatTargetKind.Player, playerId, destX, destY);
        }

        if (!wr.World.TryGetMonsterByMonsterId(combatTargetId.Value, out var monster) ||
            !IsOngoingChaseTargetStillValid(monster, wr.Settings)) {
            return false;
        }

        destX = monster.PosX;
        destY = monster.PosY;
        return true;
    }

    private void StartMovementFromIdle(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (MovementSpeedMs <= 0) {
            StartStationaryFromIdle(wr, random, now);
            return;
        }

        if (IsAttackRecoveryBlocking(now)) {
            return;
        }

        if (combatTargetKind == CombatTargetKind.None) {
            MonsterChase.EvaluateChaseForMonster(wr, this);
        }

        if (combatTargetKind != CombatTargetKind.None && combatTargetId.HasValue && TryResolveChaseDestination(wr, out var tgx, out var tgy)) {
            if (TryCastSpellAgainstChaseTarget(wr, random, now)) {
                return;
            }

            if (TryBeginMeleeAttackAgainstChaseTarget(wr, now, tgx, tgy)) {
                return;
            }

            finalDestX = tgx;
            finalDestY = tgy;
            if (!TryPickNextStepCell(wr, posX, posY, finalDestX, finalDestY, out var nx, out var ny)) {
                finalDestX = -1;
                finalDestY = -1;
                return;
            }

            ApplyGridStep(wr, nx, ny, now);
            return;
        }

        if (combatTargetKind != CombatTargetKind.None) {
            ClearChaseState();
        }

        if (!TryPickRandomDestination(wr, random, out var fx, out var fy)) {
            return;
        }

        finalDestX = fx;
        finalDestY = fy;
        if (!TryPickNextStepCell(wr, posX, posY, finalDestX, finalDestY, out var nx2, out var ny2)) {
            finalDestX = -1;
            finalDestY = -1;
            return;
        }

        ApplyGridStep(wr, nx2, ny2, now);
    }

    /// <summary>When movement speed is zero: attempt melee if the chase target is in range; otherwise hold position if the target is still valid, or clear chase.</summary>
    private void StartStationaryFromIdle(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (IsAttackRecoveryBlocking(now)) {
            return;
        }

        if (combatTargetKind == CombatTargetKind.None) {
            MonsterChase.EvaluateChaseForMonster(wr, this);
        }

        if (combatTargetKind != CombatTargetKind.None && combatTargetId.HasValue && TryResolveChaseDestination(wr, out var tgx, out var tgy)) {
            if (TryCastSpellAgainstChaseTarget(wr, random, now)) {
                return;
            }

            if (TryBeginMeleeAttackAgainstChaseTarget(wr, now, tgx, tgy)) {
                return;
            }

            return;
        }

        if (combatTargetKind != CombatTargetKind.None) {
            ClearChaseState();
        }
    }

    private void ContinueMovementAfterStep(GameWorldRef wr, Random random, DateTimeOffset now) {
        if (combatTargetKind != CombatTargetKind.None && combatTargetId.HasValue) {
            if (!TryResolveChaseDestination(wr, out var tgx, out var tgy)) {
                ClearChaseState();
                SetState(MonsterEntityState.Idle);
                StartMovementFromIdle(wr, random, now);
                return;
            }

            finalDestX = tgx;
            finalDestY = tgy;
            if (!IsAttackRecoveryBlocking(now) && TryCastSpellAgainstChaseTarget(wr, random, now)) {
                return;
            }

            if (TryBeginMeleeAttackAgainstChaseTarget(wr, now, tgx, tgy)) {
                return;
            }
        }

        if (posX == finalDestX && posY == finalDestY) {
            finalDestX = -1;
            finalDestY = -1;
            SetState(MonsterEntityState.Idle);
            if (combatTargetKind == CombatTargetKind.None) {
                var span = MaxIdleTimeMs - MinIdleTimeMs;
                var restMs = MinIdleTimeMs + (span > 0 ? random.Next(span + 1) : 0);
                stayInIdleUntil = now.AddMilliseconds(restMs);
                idleGateKind = IdleGateKind.WanderRest;
                return;
            }

            StartMovementFromIdle(wr, random, now);
            return;
        }

        if (!TryPickNextStepCell(wr, posX, posY, finalDestX, finalDestY, out var nx, out var ny)) {
            SetState(MonsterEntityState.Idle);
            finalDestX = -1;
            finalDestY = -1;
            return;
        }

        ApplyGridStep(wr, nx, ny, now);
    }

    private void ApplyGridStep(GameWorldRef wr, int newX, int newY, DateTimeOffset now) {
        var prevX = posX;
        var prevY = posY;
        wr.OccupancyTracker.SetFree(prevX, prevY);
        wr.OccupancyTracker.SetOccupied(newX, newY);
        wr.MonsterSpatialGrid.Move(this, newX, newY);
        SetGridPosition(newX, newY);
        var stepDir = Location.GetNextGridDirection(prevX, prevY, newX, newY);
        if (stepDir >= 0 && stepDir <= 7) {
            SetFacingDirection(stepDir);
        }
        SetState(MonsterEntityState.Move);
        movementDestinationDue = now.AddMilliseconds(MovementSpeedMs);
        MonsterVisibility.SyncMonsterVisibilityAfterMonsterStep(wr, this, prevX, prevY, newX, newY);
        Combat.ApplyGroundEffectStepDamageToMonster(wr, this);
    }

    private bool TryPickRandomDestination(GameWorldRef wr, Random random, out int destX, out int destY) {
        var d = DwellArea;
        var xMin = Math.Min(d.X1, d.X2);
        var xMax = Math.Max(d.X1, d.X2);
        var yMin = Math.Min(d.Y1, d.Y2);
        var yMax = Math.Max(d.Y1, d.Y2);
        const int maxAttempts = 96;
        for (var attempt = 0; attempt < maxAttempts; attempt++) {
            var x = random.Next(xMin, xMax + 1);
            var y = random.Next(yMin, yMax + 1);
            if (x == posX && y == posY) {
                continue;
            }

            if (wr.OccupancyTracker.IsFreeAndNotTeleportCell(x, y)) {
                destX = x;
                destY = y;
                return true;
            }
        }

        destX = -1;
        destY = -1;
        return false;
    }

    private static bool TryPickNextStepCell(GameWorldRef wr, int curX, int curY, int targetX, int targetY, out int nextX, out int nextY) {
        if (!Location.TryGetNeighborToward(curX, curY, targetX, targetY, out var px, out var py)) {
            nextX = curX;
            nextY = curY;
            return false;
        }

        if (wr.OccupancyTracker.IsFreeAndNotTeleportCell(px, py)) {
            nextX = px;
            nextY = py;
            return true;
        }

        var (leftX, leftY, rightX, rightY) = Location.GetAdjacentCellsAt45DegreeOffset(curX, curY, px, py);
        if (wr.OccupancyTracker.IsFreeAndNotTeleportCell(leftX, leftY)) {
            nextX = leftX;
            nextY = leftY;
            return true;
        }

        if (wr.OccupancyTracker.IsFreeAndNotTeleportCell(rightX, rightY)) {
            nextX = rightX;
            nextY = rightY;
            return true;
        }

        nextX = curX;
        nextY = curY;
        return false;
    }

    protected override int GetEffectiveMovementSpeedMsForBroadcast() => MovementSpeedMs;

    protected override int GetEffectiveAttackSpeedMsForBroadcast() => AttackSpeedMs;

    protected override int? GetEffectiveCastSpeedMsForBroadcast() => null;

    /// <summary>Fills <see cref="MonsterInRange.ActiveTemporaryEffects"/> for visibility snapshots.</summary>
    public void FillActiveTemporaryEffects(MonsterInRange snapshot) {
        ArgumentNullException.ThrowIfNull(snapshot);
        CopyActiveTemporaryEffectTypesTo(snapshot.ActiveTemporaryEffects);
    }

    public bool AddPlayerInRange(long playerId) {
        return playersInRange.Add(playerId);
    }

    public bool RemovePlayerInRange(long playerId) {
        var removed = playersInRange.Remove(playerId);
        if (removed && combatTargetKind == CombatTargetKind.Player && combatTargetId == playerId) {
            ClearChaseState();
        }

        return removed;
    }

    public void ClearPlayersInRange() {
        playersInRange.Clear();
        ClearChaseState();
    }

    public void ReplacePlayersInRange(IEnumerable<long> playerIds) {
        playersInRange.Clear();
        foreach (var id in playerIds) {
            playersInRange.Add(id);
        }

        if (combatTargetKind == CombatTargetKind.Player &&
            combatTargetId.HasValue &&
            !playersInRange.Contains(combatTargetId.Value)) {
            ClearChaseState();
        }
    }
}
