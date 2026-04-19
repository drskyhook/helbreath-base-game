namespace Server.World.Game;

/// <summary>Authoritative grid cell and facing for map entities (players, monsters, NPCs).</summary>
public abstract class GameWorldEntity {
    protected int posX;
    protected int posY;

    /// <summary>Authoritative grid facing 0–7 (matches client <c>Direction</c>); subclasses set defaults in constructors.</summary>
    protected int facingDirection;

    public int PosX => posX;
    public int PosY => posY;

    public int FacingDirection => facingDirection;

    /// <summary>Authoritative grid cell; used by spawn and movement.</summary>
    protected void SetGridPosition(int x, int y) {
        posX = x;
        posY = y;
    }

    /// <summary>Sets facing when <paramref name="direction"/> is in 0–7; otherwise no-op.</summary>
    public void SetFacingDirection(int direction) {
        if (direction >= 0 && direction <= 7) {
            facingDirection = direction;
        }
    }
}
