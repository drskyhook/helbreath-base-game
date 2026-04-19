import type { Game } from 'phaser';
import { EventBus } from '../game/EventBus';
import {
    type Effect,
    type EquipmentSlot,
    type InventoryItem,
    ItemTypes,
    RING_SLOT_LEFT,
    RING_SLOT_RIGHT,
    getItemById,
    getItemSheetIndex,
    getItemSpriteIndex,
    getTintInventoryEffectColorWithOverrides,
    isEquipmentSlot,
    type RingSlot,
} from '../constants/Items';
import {
    EQUIP_ITEM,
    IN_UI_CHANGE_GENDER,
    ITEM_ADDED_TO_BAG,
    ITEM_BAG_ITEM_BRING_TO_FRONT_REQUESTED,
    ITEM_BAG_ITEM_BROUGHT_TO_FRONT,
    ITEM_BAG_POSITION_UPDATED,
    ITEM_CONSUMED_REQUESTED,
    ITEM_CREATE_REQUESTED,
    ITEM_DROP_TO_GROUND_REQUESTED,
    ITEM_EQUIP_REQUESTED,
    ITEM_MOVED_TO_BAG,
    ITEM_REMOVED_FROM_BAG,
    SERVER_INVENTORY_SNAPSHOT_RECEIVED,
    SERVER_ITEM_ADDED_TO_BAG_RECEIVED,
    SERVER_ITEM_EQUIPPED_RECEIVED,
    SERVER_ITEM_MOVED_IN_BAG_RECEIVED,
    SERVER_ITEM_REMOVED_FROM_BAG_RECEIVED,
    SERVER_ITEM_UNEQUIPPED_RECEIVED,
} from '../constants/EventNames';
import {
    ITEM_ADDED_SOUND,
    ITEM_DROPPED_SOUND,
    ITEM_EQUIP_SOUND,
    ITEM_MOVED_TO_BAG_SOUND,
} from '../constants/SoundFileNames';
import { Gender } from '../Types';
import type { NetworkManager } from './NetworkManager';
import type { InventorySnapshotEventData, ItemEquippedEventData, ItemUnequippedEventData } from '../Types';
import { emitTintedInventorySpriteIfNeeded } from './SpriteUtils';
import { playerDialogStore } from '../ui/store/PlayerDialog.store';
import {
    getNetworkManager,
    getSoundManager,
} from './RegistryUtils';

type EquipItemEventPayload = {
    itemType: EquipmentSlot;
    itemId?: number;
    itemUid: string;
    bagX?: number;
    bagY?: number;
    quantity?: number;
    effectOverrides?: Effect[];
};

type BagItemMoveEvent = {
    itemUid: string;
    bagX?: number;
    bagY?: number;
    bagZIndex: number;
};

/**
 * Mirrors the server-authoritative inventory locally, sends requests, and applies optimistic UX for bag moves and equips.
 */
export class InventoryManager {
    public equippedItems: Partial<Record<EquipmentSlot, InventoryItem>> = {};
    public baggedItems: InventoryItem[] = [];
    /** Self-only: optimistic equips that already played their equip sound locally and should not replay on server confirmation. */
    private readonly pendingEquipSoundConfirmations = new Set<string>();
    /** Self-only: predicted bag returns that already played their move-to-bag sound locally. */
    private readonly pendingBagReturnSoundConfirmations = new Set<string>();
    /** Self-only: suppress the immediate add-to-bag sound after an item_unequipped flow already handled the audio. */
    private readonly suppressNextBagAddSound = new Set<string>();
    /** Self-only: drop request already sent; play the drop sound only when the server confirms bag removal. */
    private readonly pendingGroundDropSoundConfirmations = new Set<string>();

    constructor(private readonly game: Game) {
        const initialSnapshot = this.getNetworkManager()?.getLatestInventorySnapshot();
        if (initialSnapshot) {
            this.applySnapshot(initialSnapshot);
        }

        EventBus.on(SERVER_INVENTORY_SNAPSHOT_RECEIVED, (snapshot: InventorySnapshotEventData) => {
            this.applySnapshot(snapshot);
        });
        EventBus.on(SERVER_ITEM_ADDED_TO_BAG_RECEIVED, (payload: { item: InventoryItem }) => {
            this.applyItemAddedToBag(payload.item);
        });
        EventBus.on(SERVER_ITEM_REMOVED_FROM_BAG_RECEIVED, (payload: { itemUid: string }) => {
            this.applyItemRemovedFromBag(payload.itemUid);
        });
        EventBus.on(SERVER_ITEM_MOVED_IN_BAG_RECEIVED, (payload: BagItemMoveEvent) => {
            this.applyItemMovedInBag(payload);
        });
        EventBus.on(SERVER_ITEM_EQUIPPED_RECEIVED, (payload: ItemEquippedEventData) => {
            this.applyItemEquipped(payload);
        });
        EventBus.on(SERVER_ITEM_UNEQUIPPED_RECEIVED, (payload: ItemUnequippedEventData) => {
            this.applyItemUnequipped(payload);
        });

        EventBus.on(ITEM_CREATE_REQUESTED, (payload: { itemId: number; effectOverrides?: Effect[] }) => {
            this.getNetworkManager()?.sendCreateItemRequest(payload.itemId, payload.effectOverrides);
        });

        EventBus.on(ITEM_BAG_ITEM_BRING_TO_FRONT_REQUESTED, (payload: { itemUid: string }) => {
            const item = this.bringBagItemToFront(payload.itemUid);
            if (!item) {
                return;
            }

            EventBus.emit(ITEM_BAG_ITEM_BROUGHT_TO_FRONT, { itemUid: payload.itemUid });
        });

        EventBus.on(ITEM_MOVED_TO_BAG, (payload: { itemUid: string; itemType: EquipmentSlot | ItemTypes; bagX?: number; bagY?: number }) => {
            if (isEquipmentSlot(payload.itemType) && this.equippedItems[payload.itemType]?.itemUid === payload.itemUid) {
                this.getNetworkManager()?.sendUnequipItemRequest(payload.itemType, payload.itemUid, payload.bagX, payload.bagY);
                return;
            }

            const bagIndex = this.findBagIndex(payload.itemUid);
            if (bagIndex < 0 || payload.bagX === undefined || payload.bagY === undefined) {
                return;
            }

            this.baggedItems[bagIndex] = {
                ...this.baggedItems[bagIndex],
                bagX: payload.bagX,
                bagY: payload.bagY,
            };
            EventBus.emit(ITEM_BAG_POSITION_UPDATED, {
                itemUid: payload.itemUid,
                bagX: payload.bagX,
                bagY: payload.bagY,
            });
            this.getNetworkManager()?.sendMoveItemInBagRequest(payload.itemUid, payload.bagX, payload.bagY);
        });

        EventBus.on(ITEM_EQUIP_REQUESTED, (payload: { item: InventoryItem; itemType: ItemTypes; targetSlot?: EquipmentSlot }) => {
            const bagIndex = this.findBagIndex(payload.item.itemUid);
            if (bagIndex < 0 || payload.itemType === ItemTypes.MISC) {
                return;
            }

            const item = this.baggedItems[bagIndex];
            const itemDef = getItemById(item.itemId);
            if (!itemDef) {
                return;
            }
            if (itemDef.gender !== undefined) {
                const playerGender = playerDialogStore.state.gender;
                if (itemDef.gender !== playerGender) {
                    return;
                }
            }

            const targetSlot: EquipmentSlot = payload.itemType === ItemTypes.RING
                ? (payload.targetSlot ?? this.resolveRingTargetSlot())
                : payload.itemType;

            this.predictEquipItem(item, payload.itemType, targetSlot);
            this.getNetworkManager()?.sendEquipItemRequest(item.itemUid, payload.itemType === ItemTypes.RING ? targetSlot : undefined);
        });

        EventBus.on(ITEM_CONSUMED_REQUESTED, (payload: { item: InventoryItem }) => {
            const index = this.findBagIndex(payload.item.itemUid);
            if (index < 0) {
                return;
            }

            const itemDef = getItemById(payload.item.itemId);
            if (!itemDef || itemDef.itemType !== ItemTypes.MISC || !itemDef.consumable) {
                return;
            }

            const networkManager = this.getNetworkManager();
            if (!networkManager) {
                return;
            }

            if (itemDef.consumptionSound) {
                this.playSound(itemDef.consumptionSound);
            }
            networkManager.sendConsumeItemRequest(payload.item.itemUid);
        });

        EventBus.on(ITEM_DROP_TO_GROUND_REQUESTED, (payload: { itemUid: string }) => {
            const index = this.findBagIndex(payload.itemUid);
            if (index < 0) {
                return;
            }
            const networkManager = this.getNetworkManager();
            if (!networkManager) {
                return;
            }

            this.pendingGroundDropSoundConfirmations.add(payload.itemUid);
            networkManager.sendPlayerItemDropRequested(payload.itemUid);
        });

        EventBus.on(IN_UI_CHANGE_GENDER, (newGender: Gender) => {
            for (const [slot, equipped] of Object.entries(this.equippedItems)) {
                if (!equipped || !isEquipmentSlot(slot)) {
                    continue;
                }

                const itemDef = getItemById(equipped.itemId);
                if (itemDef?.gender !== undefined && itemDef.gender !== newGender) {
                    this.getNetworkManager()?.sendUnequipItemRequest(slot, equipped.itemUid, equipped.bagX, equipped.bagY);
                }
            }
        });
    }

    public getEquippedWeaponDef() {
        const equipped = this.equippedItems[ItemTypes.WEAPON];
        return equipped ? getItemById(equipped.itemId) : undefined;
    }

    private getNetworkManager(): NetworkManager | undefined {
        return getNetworkManager(this.game);
    }

    private playSound(key: string): void {
        const soundManager = getSoundManager(this.game);
        if (!soundManager) {
            return;
        }

        try {
            const fileName = key.endsWith('.mp3') ? key : `${key}.mp3`;
            soundManager.playOnce(fileName);
        } catch {
        }
    }

    private ensureTintedInventorySpritesEmitted(itemDef: NonNullable<ReturnType<typeof getItemById>>, effectOverrides?: Effect[]): void {
        const effectColor = getTintInventoryEffectColorWithOverrides(itemDef, effectOverrides);
        if (effectColor === undefined) {
            return;
        }

        const maleSheet = getItemSheetIndex(itemDef, Gender.MALE);
        const maleSprite = getItemSpriteIndex(itemDef, Gender.MALE);
        const femaleSheet = getItemSheetIndex(itemDef, Gender.FEMALE);
        const femaleSprite = getItemSpriteIndex(itemDef, Gender.FEMALE);

        if (maleSheet !== undefined && maleSprite !== undefined) {
            emitTintedInventorySpriteIfNeeded(this.game, maleSheet, maleSprite, effectColor);
        }
        if (femaleSheet !== undefined && femaleSprite !== undefined && (femaleSheet !== maleSheet || femaleSprite !== maleSprite)) {
            emitTintedInventorySpriteIfNeeded(this.game, femaleSheet, femaleSprite, effectColor);
        }
    }

    private cloneItem(item: InventoryItem): InventoryItem {
        return {
            ...item,
            ...(item.effectOverrides?.length && { effectOverrides: [...item.effectOverrides] }),
        };
    }

    private cloneEquippedItems(equippedItems: Partial<Record<EquipmentSlot, InventoryItem>>): Partial<Record<EquipmentSlot, InventoryItem>> {
        const nextEquippedItems: Partial<Record<EquipmentSlot, InventoryItem>> = {};
        for (const [slot, item] of Object.entries(equippedItems)) {
            if (!item || !isEquipmentSlot(slot)) {
                continue;
            }

            nextEquippedItems[slot] = this.cloneItem(item);
        }
        return nextEquippedItems;
    }

    private emitEquippedItem(slot: EquipmentSlot, item: InventoryItem | undefined): void {
        const payload: EquipItemEventPayload = item
            ? {
                itemType: slot,
                itemId: item.itemId,
                itemUid: item.itemUid,
                bagX: item.bagX,
                bagY: item.bagY,
                quantity: item.quantity,
                effectOverrides: item.effectOverrides,
            }
            : {
                itemType: slot,
                itemUid: '',
            };
        EventBus.emit(EQUIP_ITEM, payload);
    }

    private findBagIndex(itemUid: string): number {
        return this.baggedItems.findIndex((item) => item.itemUid === itemUid);
    }

    private findEquippedSlotByItemUid(itemUid: string): EquipmentSlot | undefined {
        for (const [slot, item] of Object.entries(this.equippedItems)) {
            if (item?.itemUid === itemUid && isEquipmentSlot(slot)) {
                return slot;
            }
        }
        return undefined;
    }

    private resequenceBagZIndices(): void {
        this.baggedItems = this.baggedItems.map((item, index) => ({ ...item, bagZIndex: index }));
    }

    private sortBaggedItemsByZIndex(): void {
        this.baggedItems.sort((a, b) => (a.bagZIndex ?? 0) - (b.bagZIndex ?? 0));
        this.resequenceBagZIndices();
    }

    private bringBagItemToFront(itemUid: string): InventoryItem | undefined {
        const index = this.findBagIndex(itemUid);
        if (index < 0) {
            return undefined;
        }

        const [item] = this.baggedItems.splice(index, 1);
        this.baggedItems.push(item);
        this.resequenceBagZIndices();
        return this.baggedItems[this.baggedItems.length - 1];
    }

    private clearUiState(): void {
        this.pendingEquipSoundConfirmations.clear();
        this.pendingBagReturnSoundConfirmations.clear();
        this.suppressNextBagAddSound.clear();
        for (const item of this.baggedItems) {
            EventBus.emit(ITEM_REMOVED_FROM_BAG, { itemUid: item.itemUid });
        }
        for (const [slot, item] of Object.entries(this.equippedItems)) {
            if (!item || !isEquipmentSlot(slot)) {
                continue;
            }

            this.emitEquippedItem(slot, undefined);
        }
    }

    private emitFullState(): void {
        this.sortBaggedItemsByZIndex();
        for (const item of Object.values(this.equippedItems)) {
            if (!item) {
                continue;
            }

            const itemDef = getItemById(item.itemId);
            if (itemDef) {
                this.ensureTintedInventorySpritesEmitted(itemDef, item.effectOverrides);
            }
        }
        for (const item of this.baggedItems) {
            const itemDef = getItemById(item.itemId);
            if (itemDef) {
                this.ensureTintedInventorySpritesEmitted(itemDef, item.effectOverrides);
            }
            EventBus.emit(ITEM_ADDED_TO_BAG, { item: this.cloneItem(item) });
        }
        for (const [slot, item] of Object.entries(this.equippedItems)) {
            if (!item || !isEquipmentSlot(slot)) {
                continue;
            }

            this.emitEquippedItem(slot, item);
        }
    }

    private applySnapshot(snapshot: InventorySnapshotEventData): void {
        this.pendingGroundDropSoundConfirmations.clear();
        this.clearUiState();
        this.equippedItems = this.cloneEquippedItems(snapshot.equippedItems);
        this.baggedItems = snapshot.bagItems.map((item) => this.cloneItem(item));
        this.emitFullState();
    }

    private applyItemAddedToBag(item: InventoryItem): void {
        const itemDef = getItemById(item.itemId);
        if (itemDef) {
            this.ensureTintedInventorySpritesEmitted(itemDef, item.effectOverrides);
        }
        const suppressSound = this.suppressNextBagAddSound.delete(item.itemUid);

        const existingIndex = this.findBagIndex(item.itemUid);
        const existingSlot = this.findEquippedSlotByItemUid(item.itemUid);
        if (existingIndex >= 0) {
            const previousQuantity = this.baggedItems[existingIndex].quantity ?? 1;
            this.baggedItems[existingIndex] = this.cloneItem(item);
            this.sortBaggedItemsByZIndex();
            if (!suppressSound && (item.quantity ?? 1) > previousQuantity) {
                this.playSound(ITEM_ADDED_SOUND);
            }
            EventBus.emit(ITEM_REMOVED_FROM_BAG, { itemUid: item.itemUid });
            EventBus.emit(ITEM_ADDED_TO_BAG, { item: this.cloneItem(item) });
            return;
        }

        this.baggedItems.push(this.cloneItem(item));
        this.sortBaggedItemsByZIndex();
        if (!suppressSound) {
            this.playSound(existingSlot ? ITEM_MOVED_TO_BAG_SOUND : ITEM_ADDED_SOUND);
        }
        EventBus.emit(ITEM_ADDED_TO_BAG, { item: this.cloneItem(item) });
    }

    private applyItemRemovedFromBag(itemUid: string): void {
        const index = this.findBagIndex(itemUid);
        if (index < 0) {
            this.pendingGroundDropSoundConfirmations.delete(itemUid);
            return;
        }

        this.baggedItems.splice(index, 1);
        this.resequenceBagZIndices();
        if (this.pendingGroundDropSoundConfirmations.delete(itemUid)) {
            this.playSound(ITEM_DROPPED_SOUND);
        }
        EventBus.emit(ITEM_REMOVED_FROM_BAG, { itemUid });
    }

    private applyItemMovedInBag(payload: BagItemMoveEvent): void {
        const index = this.findBagIndex(payload.itemUid);
        if (index < 0) {
            return;
        }

        this.baggedItems[index] = {
            ...this.baggedItems[index],
            ...(payload.bagX !== undefined ? { bagX: payload.bagX } : {}),
            ...(payload.bagY !== undefined ? { bagY: payload.bagY } : {}),
            bagZIndex: payload.bagZIndex,
        };
        this.sortBaggedItemsByZIndex();
        if (payload.bagX !== undefined && payload.bagY !== undefined) {
            EventBus.emit(ITEM_BAG_POSITION_UPDATED, {
                itemUid: payload.itemUid,
                bagX: payload.bagX,
                bagY: payload.bagY,
            });
        }
        EventBus.emit(ITEM_BAG_ITEM_BROUGHT_TO_FRONT, { itemUid: payload.itemUid });
    }

    private applyItemEquipped(payload: ItemEquippedEventData): void {
        this.equippedItems[payload.slot] = this.cloneItem(payload.item);
        if (!this.pendingEquipSoundConfirmations.delete(payload.item.itemUid)) {
            this.playSound(ITEM_EQUIP_SOUND);
        }
        this.emitEquippedItem(payload.slot, payload.item);
    }

    private applyItemUnequipped(payload: ItemUnequippedEventData): void {
        const current = this.equippedItems[payload.slot];
        if (!current || (payload.itemUid && current.itemUid !== payload.itemUid)) {
            return;
        }

        this.equippedItems[payload.slot] = undefined;
        this.pendingEquipSoundConfirmations.delete(payload.itemUid);
        this.suppressNextBagAddSound.add(payload.itemUid);
        if (!this.pendingBagReturnSoundConfirmations.delete(payload.itemUid)) {
            this.playSound(ITEM_MOVED_TO_BAG_SOUND);
        }
        this.emitEquippedItem(payload.slot, undefined);
    }

    private resolveRingTargetSlot(): RingSlot {
        if (!this.equippedItems[RING_SLOT_LEFT]) {
            return RING_SLOT_LEFT;
        }
        if (!this.equippedItems[RING_SLOT_RIGHT]) {
            return RING_SLOT_RIGHT;
        }
        return RING_SLOT_LEFT;
    }

    private predictEquipItem(item: InventoryItem, itemType: ItemTypes, targetSlot: EquipmentSlot): void {
        const bagIndex = this.findBagIndex(item.itemUid);
        if (bagIndex < 0) {
            return;
        }

        const itemDef = getItemById(item.itemId);
        if (!itemDef) {
            return;
        }

        const unequipToBag = (slot: EquipmentSlot, emitUnequipEvent: boolean) => {
            const equipped = this.equippedItems[slot];
            if (!equipped) {
                return;
            }

            this.equippedItems[slot] = undefined;
            this.pendingBagReturnSoundConfirmations.add(equipped.itemUid);
            this.baggedItems.push(this.cloneItem(equipped));
            this.resequenceBagZIndices();
            this.playSound(ITEM_MOVED_TO_BAG_SOUND);
            EventBus.emit(ITEM_ADDED_TO_BAG, { item: this.cloneItem(equipped) });
            if (emitUnequipEvent) {
                this.emitEquippedItem(slot, undefined);
            }
        };

        for (const [slot, equipped] of Object.entries(this.equippedItems)) {
            if (!equipped || !isEquipmentSlot(slot)) {
                continue;
            }

            const equippedDef = getItemById(equipped.itemId);
            if (equippedDef?.blockedItemSlots?.includes(itemType)) {
                unequipToBag(slot, true);
            }
        }

        for (const blockedSlot of itemDef.blockedItemSlots ?? []) {
            if (isEquipmentSlot(blockedSlot)) {
                unequipToBag(blockedSlot, true);
            }
        }

        const [equippedItem] = this.baggedItems.splice(bagIndex, 1);
        this.resequenceBagZIndices();
        EventBus.emit(ITEM_REMOVED_FROM_BAG, { itemUid: equippedItem.itemUid });

        const previouslyEquipped = this.equippedItems[targetSlot];
        if (previouslyEquipped) {
            this.baggedItems.push(this.cloneItem(previouslyEquipped));
            this.resequenceBagZIndices();
            this.playSound(ITEM_MOVED_TO_BAG_SOUND);
            EventBus.emit(ITEM_ADDED_TO_BAG, { item: this.cloneItem(previouslyEquipped) });
        }

        this.equippedItems[targetSlot] = equippedItem;
        this.pendingEquipSoundConfirmations.add(equippedItem.itemUid);
        this.playSound(ITEM_EQUIP_SOUND);
        this.emitEquippedItem(targetSlot, equippedItem);
    }
}
