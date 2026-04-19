using Server.World.Game;

namespace Server.Helpers;

/// <summary>Server-side rules for whether aim-assist may snap to an invisible target (anti-cheat vs semi-visible allies).</summary>
public static class SpellAimAssist {
    /// <summary>True when the caster is targeting themselves (e.g. buff on self while invisible).</summary>
    public static bool AllowsInvisiblePlayerTarget(GameWorldPlayer caster, GameWorldPlayer targetPlayer) {
        ArgumentNullException.ThrowIfNull(caster);
        ArgumentNullException.ThrowIfNull(targetPlayer);
        return targetPlayer.PlayerId == caster.PlayerId;
    }

    /// <summary>True for friendly monsters (semi-visible); hostile/neutral invisible targets must not be aim-snapped.</summary>
    public static bool AllowsInvisibleMonsterTarget(GameWorldMonster monster) {
        ArgumentNullException.ThrowIfNull(monster);
        return monster.Allegiance == MonsterAllegiance.Friendly;
    }
}
