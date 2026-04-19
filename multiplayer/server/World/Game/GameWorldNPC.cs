namespace Server.World.Game;

/// <summary>Server-authoritative stationary NPC instance: unique id, catalog id, grid cell, and facing.</summary>
public sealed class GameWorldNPC : GameWorldEntity {
    public long NpcId { get; }
    public int CatalogNpcId { get; }
    /// <summary>When true, this NPC claimed a walkable cell via <c>SetOccupied</c> and removal must <c>SetFree</c>; false on map-blocked tiles where occupancy was already marked.</summary>
    public bool OwnsOccupancyCell { get; }

    public GameWorldNPC(long npcId, int catalogNpcId, int posX, int posY, int facingDirection, bool ownsOccupancyCell = true) {
        if (facingDirection < 0 || facingDirection > 7) {
            throw new ArgumentOutOfRangeException(nameof(facingDirection), "Facing direction must be 0-7.");
        }

        NpcId = npcId;
        CatalogNpcId = catalogNpcId;
        OwnsOccupancyCell = ownsOccupancyCell;
        SetGridPosition(posX, posY);
        SetFacingDirection(facingDirection);
    }
}
