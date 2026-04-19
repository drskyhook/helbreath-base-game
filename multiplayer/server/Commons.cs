namespace Server;

/// <summary>How a melee hit applies damage on the target (monsters and players). <see cref="Interrupt"/> uses the same take-damage animation as <see cref="Stun"/> but does not apply stunlock.</summary>
public enum AttackType {
    NoInterrupt = 0,
    Interrupt = 1,
    Stun = 2,
    Knockback = 3,
}

/// <summary>How a monster acquires or avoids combat targets. Neutral monsters only chase after being attacked.</summary>
public enum MonsterAllegiance {
    Hostile = 0,
    Neutral = 1,
    Friendly = 2,
}

/// <summary>How a spell applies damage in the world. Config uses the numeric enum value.</summary>
public enum DamageType {
    RectangleAoe = 0,
    ConeAoe = 1,
    LinearAoe = 2,
    /// <summary>Damage applies only to the targeted cell; no <c>aoeRadius</c> in spell config.</summary>
    SingleCell = 3,
    /// <summary>Long-lived immobile ground effect that either ticks periodically or triggers when actors step onto its cell.</summary>
    GroundEffect = 4,
}

/// <summary>Visual / gameplay kind of a long-lived ground effect instance.</summary>
public enum GroundEffectType {
    Fire = 0,
    Poison = 1,
    SpikeField = 2,
    IceStorm = 3,
}
