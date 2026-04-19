namespace Server.Utils;

/// <summary>Tracks one active temporary effect’s exclusive <see cref="Group"/>, scheduler timer id for expiry, and additive speed modifiers from the spell row.</summary>
public sealed class ActiveTemporaryEffectSlot {
    public int Group { get; init; }
    public int ExpiryTimerId { get; init; }
    /// <summary>Sum of <c>movementSpeedModifier</c> from the applying spell row; 0 when omitted.</summary>
    public double MovementSpeedModifier { get; init; }
    /// <summary>Sum of <c>attackSpeedModifier</c> from the applying spell row; 0 when omitted.</summary>
    public double AttackSpeedModifier { get; init; }
    /// <summary>Sum of <c>castSpeedModifier</c> from the applying spell row; 0 when omitted (players only).</summary>
    public double CastSpeedModifier { get; init; }
}
