namespace Server.Utils;

/// <summary>Maps additive speed modifiers from spell config to effective duration ms. Modifiers sum per axis; effective duration = base / (1 + sum).</summary>
public static class TemporaryEffectSpeedModifierMath {
    /// <summary>Minimum allowed value for (1 + sum) before applying duration.</summary>
    public const double MinDenominator = 0.05;

    /// <summary>Maximum allowed value for (1 + sum) before applying duration.</summary>
    public const double MaxDenominator = 3.0;

    /// <summary>Each per-effect modifier in JSON must lie in this range so stacked sums stay sane.</summary>
    public const double MinModifier = -0.95;

    /// <summary>Each per-effect modifier in JSON must lie in this range so stacked sums stay sane.</summary>
    public const double MaxModifier = 2.0;

    /// <summary>Returns <paramref name="onePlusSum"/> clamped to <see cref="MinDenominator"/>–<see cref="MaxDenominator"/>.</summary>
    public static double ClampDenominator(double onePlusSum) {
        if (onePlusSum < MinDenominator) {
            return MinDenominator;
        }

        if (onePlusSum > MaxDenominator) {
            return MaxDenominator;
        }

        return onePlusSum;
    }

    /// <summary>Effective duration ms from base duration and summed modifiers; <paramref name="baseDurationMs"/> ≤ 0 returns <paramref name="baseDurationMs"/> unchanged.</summary>
    public static int ApplyModifierSumToDurationMs(int baseDurationMs, double modifierSum) {
        if (baseDurationMs <= 0) {
            return baseDurationMs;
        }

        var denom = ClampDenominator(1.0 + modifierSum);
        return (int)Math.Round(baseDurationMs / denom);
    }
}
