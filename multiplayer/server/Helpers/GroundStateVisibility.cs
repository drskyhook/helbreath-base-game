using Server.World;
using Server.Utils;
using Server.World.Game;

namespace Server.Helpers;

/// <summary>View-radius queries and bulk enter/leave packets for long-lived ground effects plus top-most dropped ground items.</summary>
public static class GroundStateVisibility {
    /// <summary>Clears <paramref name="destination"/> and fills it with every active ground effect inside the player's rectangular view bounds.</summary>
    public static void FillNearbyGroundEffectsById(GameWorldRef wr, int centerX, int centerY, Dictionary<long, GroundEffectState> destination) {
        ArgumentNullException.ThrowIfNull(destination);
        wr.GroundStateTracker.FillEffectsInRectangle(
            centerX - wr.Settings.Radius.ViewRadiusX,
            centerY - wr.Settings.Radius.ViewRadiusY,
            centerX + wr.Settings.Radius.ViewRadiusX,
            centerY + wr.Settings.Radius.ViewRadiusY,
            destination);
    }

    /// <summary>Clears <paramref name="destination"/> and fills it with every visible top-most ground item inside the player's rectangular view bounds.</summary>
    public static void FillNearbyGroundItemsById(GameWorldRef wr, int centerX, int centerY, Dictionary<long, GroundItemState> destination) {
        ArgumentNullException.ThrowIfNull(destination);
        wr.GroundStateTracker.FillTopItemsInRectangle(
            centerX - wr.Settings.Radius.ViewRadiusX,
            centerY - wr.Settings.Radius.ViewRadiusY,
            centerX + wr.Settings.Radius.ViewRadiusX,
            centerY + wr.Settings.Radius.ViewRadiusY,
            destination);
    }

    /// <summary>Reconciles <paramref name="player"/>'s visible ground effects and top-most ground items after movement.</summary>
    public static void SyncPlayerGroundStateAfterMovement(GameWorldRef wr, GameWorldPlayer player) {
        ArgumentNullException.ThrowIfNull(player);

        var previouslyVisibleEffects = wr.GroundEffectsPreviouslyInRangeScratch;
        previouslyVisibleEffects.Clear();
        previouslyVisibleEffects.UnionWith(player.GroundEffectsInRange);

        FillNearbyGroundEffectsById(wr, player.PosX, player.PosY, wr.NearbyGroundEffectsByIdScratch);
        var visibleEffectsNow = wr.NearbyGroundEffectsByIdScratch;

        var enteredEffects = wr.GroundEffectsEnteredScratch;
        enteredEffects.Clear();
        foreach (var kv in visibleEffectsNow) {
            if (!previouslyVisibleEffects.Contains(kv.Key)) {
                enteredEffects.Add(kv.Value);
            }
        }

        var leftEffects = wr.GroundEffectsLeftScratch;
        leftEffects.Clear();
        foreach (var groundEffectId in previouslyVisibleEffects) {
            if (visibleEffectsNow.ContainsKey(groundEffectId)) {
                continue;
            }
            if (wr.GroundStateTracker.TryGetEffect(groundEffectId, out var effect)) {
                leftEffects.Add(effect);
            }
        }

        var previouslyVisibleItems = wr.GroundItemsPreviouslyInRangeScratch;
        previouslyVisibleItems.Clear();
        previouslyVisibleItems.UnionWith(player.GroundItemsInRange);

        FillNearbyGroundItemsById(wr, player.PosX, player.PosY, wr.NearbyGroundItemsByIdScratch);
        var visibleItemsNow = wr.NearbyGroundItemsByIdScratch;

        var enteredItems = wr.GroundItemsEnteredScratch;
        enteredItems.Clear();
        foreach (var kv in visibleItemsNow) {
            if (!previouslyVisibleItems.Contains(kv.Key)) {
                enteredItems.Add(kv.Value);
            }
        }

        var leftItems = wr.GroundItemsLeftScratch;
        leftItems.Clear();
        foreach (var groundItemUid in previouslyVisibleItems) {
            if (visibleItemsNow.ContainsKey(groundItemUid)) {
                continue;
            }
            if (wr.GroundStateTracker.TryGetTopGroundItem(groundItemUid, out var item)) {
                leftItems.Add(item);
            }
        }

        if ((leftEffects.Count > 0 || leftItems.Count > 0) && !player.Disconnected) {
            NetworkManager.SendToPlayer(player, NetworkManager.CreateGroundStatesLeftRange(wr, leftEffects, leftItems));
        }

        if ((enteredEffects.Count > 0 || enteredItems.Count > 0) && !player.Disconnected) {
            NetworkManager.SendToPlayer(player, NetworkManager.CreateGroundStatesEnteredRange(wr, enteredEffects, enteredItems));
        }

        player.ReplaceGroundEffectsInRange(visibleEffectsNow.Keys);
        player.ReplaceGroundItemsInRange(visibleItemsNow.Keys);
    }

    /// <summary>Sends all currently visible ground effects and top-most ground items to a player when they join or reconnect.</summary>
    public static void SendGroundStatesInRangeOnPlayerJoin(GameWorldRef wr, GameWorldPlayer player) {
        ArgumentNullException.ThrowIfNull(player);

        FillNearbyGroundEffectsById(wr, player.PosX, player.PosY, wr.NearbyGroundEffectsByIdScratch);
        var visibleEffects = wr.NearbyGroundEffectsByIdScratch;
        FillNearbyGroundItemsById(wr, player.PosX, player.PosY, wr.NearbyGroundItemsByIdScratch);
        var visibleItems = wr.NearbyGroundItemsByIdScratch;
        if ((visibleEffects.Count > 0 || visibleItems.Count > 0) && !player.Disconnected) {
            NetworkManager.SendToPlayer(player, NetworkManager.CreateGroundStatesEnteredRange(wr, visibleEffects.Values, visibleItems.Values));
        }

        player.ReplaceGroundEffectsInRange(visibleEffects.Keys);
        player.ReplaceGroundItemsInRange(visibleItems.Keys);
    }

    /// <summary>Broadcasts newly created ground effects to nearby viewers that do not already track those ids.</summary>
    public static void BroadcastGroundEffectsCreated(GameWorldRef wr, IReadOnlyList<GroundEffectState> effects) {
        ArgumentNullException.ThrowIfNull(effects);
        if (effects.Count == 0) {
            return;
        }

        var viewers = wr.GroundEffectsViewersScratch;
        viewers.Clear();
        foreach (var effect in effects) {
            foreach (var viewer in wr.PlayerSpatialGrid.GetNearbyPlayers(effect.PosX, effect.PosY, excludeDisconnected: false)) {
                viewers[viewer.PlayerId] = viewer;
            }
        }

        var visibleEffects = wr.GroundEffectsEnteredScratch;
        foreach (var viewer in viewers.Values) {
            visibleEffects.Clear();
            foreach (var effect in effects) {
                if (!IsEffectVisibleToPlayer(wr, viewer, effect)) {
                    continue;
                }
                if (viewer.IsGroundEffectInRange(effect.GroundEffectId)) {
                    continue;
                }

                visibleEffects.Add(effect);
            }

            if (visibleEffects.Count == 0) {
                continue;
            }

            if (!viewer.Disconnected) {
                NetworkManager.SendToPlayer(viewer, NetworkManager.CreateGroundStatesEnteredRange(wr, visibleEffects));
            }

            foreach (var effect in visibleEffects) {
                viewer.AddGroundEffectInRange(effect.GroundEffectId);
            }
        }
    }

    /// <summary>Broadcasts one expired ground effect (avoids allocating a single-element array).</summary>
    public static void BroadcastGroundEffectsRemoved(GameWorldRef wr, GroundEffectState effect) {
        ArgumentNullException.ThrowIfNull(effect);

        var viewers = wr.GroundEffectsViewersScratch;
        viewers.Clear();
        foreach (var viewer in wr.PlayerSpatialGrid.GetNearbyPlayers(effect.PosX, effect.PosY, excludeDisconnected: false)) {
            viewers[viewer.PlayerId] = viewer;
        }

        foreach (var viewer in viewers.Values) {
            if (!viewer.IsGroundEffectInRange(effect.GroundEffectId)) {
                continue;
            }
            if (!IsEffectVisibleToPlayer(wr, viewer, effect)) {
                continue;
            }

            if (!viewer.Disconnected) {
                NetworkManager.SendToPlayer(viewer, NetworkManager.CreateGroundStatesLeftRange(wr, effect));
            }

            viewer.RemoveGroundEffectInRange(effect.GroundEffectId);
        }
    }

    /// <summary>Broadcasts expired ground effects to nearby viewers that still track those ids.</summary>
    public static void BroadcastGroundEffectsRemoved(GameWorldRef wr, IReadOnlyList<GroundEffectState> effects) {
        ArgumentNullException.ThrowIfNull(effects);
        if (effects.Count == 0) {
            return;
        }

        var viewers = wr.GroundEffectsViewersScratch;
        viewers.Clear();
        foreach (var effect in effects) {
            foreach (var viewer in wr.PlayerSpatialGrid.GetNearbyPlayers(effect.PosX, effect.PosY, excludeDisconnected: false)) {
                viewers[viewer.PlayerId] = viewer;
            }
        }

        var removedEffects = wr.GroundEffectsLeftScratch;
        foreach (var viewer in viewers.Values) {
            removedEffects.Clear();
            foreach (var effect in effects) {
                if (!viewer.IsGroundEffectInRange(effect.GroundEffectId)) {
                    continue;
                }
                if (!IsEffectVisibleToPlayer(wr, viewer, effect)) {
                    continue;
                }

                removedEffects.Add(effect);
            }

            if (removedEffects.Count == 0) {
                continue;
            }

            if (!viewer.Disconnected) {
                NetworkManager.SendToPlayer(viewer, NetworkManager.CreateGroundStatesLeftRange(wr, removedEffects));
            }

            foreach (var effect in removedEffects) {
                viewer.RemoveGroundEffectInRange(effect.GroundEffectId);
            }
        }
    }

    /// <summary>Broadcasts a top-of-stack ground-item change for one cell, removing the old visible top and revealing the new one when present.</summary>
    public static void BroadcastGroundItemTopStateChanged(GameWorldRef wr, GroundItemState? removedItem, GroundItemState? addedItem) {
        if (removedItem is null && addedItem is null) {
            return;
        }

        var viewers = wr.GroundItemsViewersScratch;
        viewers.Clear();
        if (removedItem is not null) {
            foreach (var viewer in wr.PlayerSpatialGrid.GetNearbyPlayers(removedItem.PosX, removedItem.PosY, excludeDisconnected: false)) {
                viewers[viewer.PlayerId] = viewer;
            }
        }
        if (addedItem is not null) {
            foreach (var viewer in wr.PlayerSpatialGrid.GetNearbyPlayers(addedItem.PosX, addedItem.PosY, excludeDisconnected: false)) {
                viewers[viewer.PlayerId] = viewer;
            }
        }

        foreach (var viewer in viewers.Values) {
            if (removedItem is not null &&
                viewer.IsGroundItemInRange(removedItem.ItemUid) &&
                IsGroundItemVisibleToPlayer(wr, viewer, removedItem)) {
                if (!viewer.Disconnected) {
                    NetworkManager.SendToPlayer(
                        viewer,
                        NetworkManager.CreateGroundStatesLeftRange(wr, removedItem));
                }

                viewer.RemoveGroundItemInRange(removedItem.ItemUid);
            }

            if (addedItem is not null &&
                !viewer.IsGroundItemInRange(addedItem.ItemUid) &&
                IsGroundItemVisibleToPlayer(wr, viewer, addedItem)) {
                if (!viewer.Disconnected) {
                    NetworkManager.SendToPlayer(
                        viewer,
                        NetworkManager.CreateGroundStatesEnteredRange(wr, addedItem));
                }

                viewer.AddGroundItemInRange(addedItem.ItemUid);
            }
        }
    }

    private static bool IsEffectVisibleToPlayer(GameWorldRef wr, GameWorldPlayer player, GroundEffectState effect) {
        return Math.Abs(effect.PosX - player.PosX) <= wr.Settings.Radius.ViewRadiusX &&
               Math.Abs(effect.PosY - player.PosY) <= wr.Settings.Radius.ViewRadiusY;
    }

    private static bool IsGroundItemVisibleToPlayer(GameWorldRef wr, GameWorldPlayer player, GroundItemState item) {
        return Math.Abs(item.PosX - player.PosX) <= wr.Settings.Radius.ViewRadiusX &&
               Math.Abs(item.PosY - player.PosY) <= wr.Settings.Radius.ViewRadiusY;
    }
}
