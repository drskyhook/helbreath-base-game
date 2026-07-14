# Engine Vision

## Purpose

Build a modern, open-source foundation for persistent, community-driven 2D online RPGs inspired by classic games such as Helbreath.

The engine should preserve the strengths of old-school RPG design while modernizing architecture, tooling, asset workflows, and contributor experience.

## Guiding Principles

- Preserve the spirit, modernize the implementation.
- Keep the server authoritative.
- Prefer open, inspectable formats.
- Keep authoring tools optional and interchangeable.
- Support legacy Helbreath formats through adapters.
- Keep runtime systems independent from source asset formats.
- Favor simple, maintainable systems over premature complexity.
- Make it easy for future contributors to add content.


## Current Architecture

- Server: C# / .NET
- Client: TypeScript
- Rendering: Phaser
- UI: React
- Networking: WebSockets + Protobuf
- Legacy sprites: `.spr`
- Legacy maps: `.amd`

## Asset Direction

### Legacy Support

The engine should continue to support:

- `.spr` sprite assets
- `.amd` maps

These formats should be treated as compatibility adapters, not the preferred authoring format for new content.


### Modern Sprite Direction

New sprite content should use an editor-independent runtime format based on:

- PNG texture atlas
- JSON frame and animation metadata
- semantic animation names
- pivots
- per-frame timing where needed

The engine should not require Aseprite, Photoshop, Krita, or any specific AI tool.

### Modern Map Direction

New maps should eventually support a common visual editor format, likely Tiled JSON/TMJ.

Legacy AMD maps should continue to work during migration.

## Runtime Boundaries

Rendering systems should consume normalized runtime definitions rather than knowing whether an asset originated from:

- SPR
- Aseprite
- Photoshop
- TexturePacker
- AI generation
- Tiled
- another future tool

## Near-Term Priorities

1. Preserve all existing SPR behavior.
2. Add an explicit sprite format boundary.
3. Define a generic sprite atlas contract.
4. Load one original monster from PNG + JSON.
5. Keep Bog Rat as the first test asset.
6. Evaluate Tiled map support only after the sprite path works.

## Deferred Decisions

- Replacing all legacy assets
- Full map editor development
- Skeletal animation
- Mobile client support
- Steam packaging
- Modding API
- Custom content editor
- Procedural generation