import React, { useState, useEffect, useCallback } from 'react';
import { ItemDefinition, InventoryItem, DbConnection, Campfire as SpacetimeDBCampfire, ItemCategory } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';

// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import shared types
import { PopulatedItem } from './InventoryUI'; // Assuming PopulatedItem is exported from InventoryUI
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes'; // Updated import location
import { PlacementItemInfo } from '../hooks/usePlacementManager';

// Style constants similar to PlayerUI
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';
const SLOT_SIZE = 60; // Size of each hotbar slot in pixels
const SLOT_MARGIN = 6;
const SELECTED_BORDER_COLOR = '#ffffff';

// Update HotbarProps
interface HotbarProps {
  playerIdentity: Identity | null;
  itemDefinitions: Map<string, ItemDefinition>;
  inventoryItems: Map<string, InventoryItem>;
  connection: DbConnection | null;
  onItemDragStart: (info: DraggedItemInfo) => void;
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
  draggedItemInfo: DraggedItemInfo | null;
  interactingWith: { type: string; id: number | bigint } | null;
  campfires: Map<string, SpacetimeDBCampfire>;
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
}

// --- Hotbar Component ---
const Hotbar: React.FC<HotbarProps> = ({
    playerIdentity,
    itemDefinitions,
    inventoryItems,
    connection,
    onItemDragStart,
    onItemDrop,
    draggedItemInfo,
    interactingWith,
    campfires,
    startPlacement,
    cancelPlacement,
}) => {
  // console.log("Hotbar Props:", { playerIdentity, itemDefinitions, inventoryItems }); // Log received props
  const [selectedSlot, setSelectedSlot] = useState<number>(0); // 0-indexed (0-5)
  const numSlots = 6;
  const currentInventoryItems = inventoryItems || new Map<string, InventoryItem>();
  const currentItemDefinitions = itemDefinitions || new Map<string, ItemDefinition>();

  // Updated findItemForSlot to return PopulatedItem, wrapped in useCallback
  const findItemForSlot = useCallback((slotIndex: number): PopulatedItem | null => {
    if (!playerIdentity) return null;
    // Use props directly inside useCallback dependencies
    for (const itemInstance of inventoryItems.values()) { 
      if (itemInstance.playerIdentity.isEqual(playerIdentity) && itemInstance.hotbarSlot === slotIndex) {
        const definition = itemDefinitions.get(itemInstance.itemDefId.toString());
        if (definition) {
            return { instance: itemInstance, definition };
        }
      }
    }
    return null;
  }, [playerIdentity, inventoryItems, itemDefinitions]); // Dependencies for useCallback

  // Find the currently selected item
  const selectedInventoryItem = findItemForSlot(selectedSlot);
  const selectedItemDef = selectedInventoryItem ? itemDefinitions.get(selectedInventoryItem.instance.itemDefId.toString()) : null;

  // Define handleKeyDown with useCallback
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const inventoryPanel = document.querySelector('.inventoryPanel');
    if (inventoryPanel) return;
    const keyNum = parseInt(event.key);
    if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= numSlots) {
      const newSlotIndex = keyNum - 1;
      setSelectedSlot(newSlotIndex); // Select the slot regardless of action

      const itemInNewSlot = findItemForSlot(newSlotIndex);
      if (!connection?.reducers) {
          console.warn("No connection/reducers for keydown action");
          return;
      }
      
      // --- Determine Action Based on Item in Slot --- 
      if (itemInNewSlot) {
          const categoryTag = itemInNewSlot.definition.category.tag;
          const name = itemInNewSlot.definition.name;
          const instanceId = BigInt(itemInNewSlot.instance.instanceId);

          if (categoryTag === 'Consumable') {
              console.log(`Hotbar Key ${keyNum}: Consuming item instance ${instanceId} (${name})`);
              cancelPlacement(); // Cancel placement if consuming
              try {
                  connection.reducers.consumeItem(instanceId);
              } catch (err) { 
                  console.error(`[Hotbar KeyDown] Error consuming item ${instanceId}:`, err);
              }
              // No equip/unequip needed after consuming
          } else if (categoryTag === 'Armor') {
              console.log(`Hotbar Key ${keyNum}: Equipping ARMOR instance ${instanceId} (${name})`);
              cancelPlacement();
              try { connection.reducers.equipArmor(instanceId); } catch (err) { console.error("Error equipArmor:", err); }
          } else if (categoryTag === 'Placeable') {
              console.log(`Hotbar Key ${keyNum}: Starting placement for ${name}.`);
              const placementInfo: PlacementItemInfo = {
                  itemDefId: BigInt(itemInNewSlot.definition.id),
                  itemName: name,
                  iconAssetName: itemInNewSlot.definition.iconAssetName
              };
              startPlacement(placementInfo);
              try { connection.reducers.unequipItem(); } catch (err) { console.error("Error unequip:", err); }
          } else if (itemInNewSlot.definition.isEquippable) {
              console.log(`Hotbar Key ${keyNum}: Equipping item instance ${instanceId} (${name})`);
              cancelPlacement();
              try { connection.reducers.equipItem(instanceId); } catch (err) { console.error("Error equip:", err); }
          } else {
              // Item exists but isn't consumable, armor, campfire, or equippable - treat as selecting non-actionable (unequip current)
              console.log(`Hotbar Key ${keyNum}: Selected non-actionable item (${name}), unequipping.`);
              cancelPlacement();
              try { connection.reducers.unequipItem(); } catch (err) { console.error("Error unequip:", err); }
          }
      } else {
          // Slot is empty - Unequip current item
          console.log(`Hotbar Key ${keyNum}: Slot empty, unequipping.`);
          cancelPlacement();
          try { connection.reducers.unequipItem(); } catch (err) { console.error("Error unequip:", err); }
      }
    }
  }, [numSlots, findItemForSlot, connection, cancelPlacement, startPlacement]);

  // Effect for handling hotbar interaction (keyboard only now)
  useEffect(() => {
    // Add the memoized listener
    window.addEventListener('keydown', handleKeyDown);

    // Remove the memoized listener on cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // Only depend on the memoized handler function
  }, [handleKeyDown]);

  // --- Click Handler for Slots --- 
  const handleSlotClick = (index: number) => {
      setSelectedSlot(index);
      const clickedItem = findItemForSlot(index);
      if (!connection?.reducers || !clickedItem) { // Check for item early
         if (!clickedItem) {
             console.log(`Hotbar Click: Slot ${index + 1} empty, unequipping.`);
             cancelPlacement(); // Cancel placement if slot empty
             try { connection?.reducers.unequipItem(); } catch (err) { console.error("Error unequip:", err); }
         }
         return; 
      }

      // Check item category
      const categoryTag = clickedItem.definition.category.tag;
      const name = clickedItem.definition.name;
      const instanceId = BigInt(clickedItem.instance.instanceId);

      if (categoryTag === 'Consumable') {
          console.log(`Hotbar Click: Consuming item instance ${instanceId} (${name}) in slot ${index + 1}`);
          cancelPlacement(); // Should not be placing and consuming
          try {
              connection.reducers.consumeItem(instanceId);
          } catch (err) {
              console.error(`Error consuming item ${instanceId}:`, err);
          }
      } else if (categoryTag === 'Armor') {
          console.log(`Hotbar Click: Equipping ARMOR instance ${instanceId} (${name}) in slot ${index + 1}`);
          cancelPlacement();
          try { connection.reducers.equipArmor(instanceId); } catch (err) { console.error("Error equipArmor:", err); }
      } else if (categoryTag === 'Placeable') {
          console.log(`Hotbar Click: Starting placement for ${name} (Slot ${index + 1}).`);
          const placementInfo: PlacementItemInfo = {
              itemDefId: BigInt(clickedItem.definition.id),
              itemName: name,
              iconAssetName: clickedItem.definition.iconAssetName
          };
          startPlacement(placementInfo);
          try { connection.reducers.unequipItem(); } catch (err) { console.error("Error unequip:", err); }
      } else if (clickedItem.definition.isEquippable) {
          console.log(`Hotbar Click: Equipping item instance ${instanceId} (${name}) in slot ${index + 1}`);
          cancelPlacement();
          try { connection.reducers.equipItem(instanceId); } catch (err) { console.error("Error equip:", err); }
      } else {
          // Default: If not consumable, armor, campfire, or equippable, treat as selecting non-actionable item (unequip current hand item)
          console.log(`Hotbar Click: Slot ${index + 1} contains non-actionable item (${name}), unequipping.`);
          cancelPlacement();
          try { connection.reducers.unequipItem(); } catch (err) { console.error("Error unequip:", err); }
      }
  };

  // --- Context Menu Handler for Hotbar Items ---
  const handleHotbarItemContextMenu = (event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem) => {
      event.preventDefault();
      event.stopPropagation();
      console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} in slot ${itemInfo.instance.hotbarSlot}`);
      if (!connection?.reducers) return;

      const itemInstanceId = BigInt(itemInfo.instance.instanceId);

      // Check if interacting with campfire and item is Wood
      if (interactingWith?.type === 'campfire' && itemInfo.definition.name === 'Wood') {
          const campfireIdNum = Number(interactingWith.id);
          console.log(`[Hotbar ContextMenu] Wood right-clicked while Campfire ${campfireIdNum} open. Calling add_wood...`);
          try {
              connection.reducers.addWoodToFirstAvailableCampfireSlot(campfireIdNum, itemInstanceId);
          } catch (error: any) {
              console.error("[Hotbar ContextMenu] Error calling add_wood... reducer:", error);
          }
      } 
      // --- NEW: Check if the item is Armor --- 
      else if (itemInfo.definition.category.tag === 'Armor') {
           console.log(`[Hotbar ContextMenu] Item is Armor. Calling equip_armor for item ${itemInstanceId}`);
           try {
               connection.reducers.equipArmor(itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu] Failed to call equipArmor reducer:", error);
          }
      } else {
          // Default behavior for right-clicking other items in hotbar (if any desired later)
          console.log("[Hotbar ContextMenu] No specific action for this item/context (Not Wood in Campfire context, Not Armor).");
      }
  };

  // console.log(`[Hotbar Render] selectedSlot is: ${selectedSlot}`);

  return (
    <div style={{
      position: 'fixed',
      bottom: '15px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      backgroundColor: UI_BG_COLOR,
      padding: `${SLOT_MARGIN}px`,
      borderRadius: '4px',
      border: `1px solid ${UI_BORDER_COLOR}`,
      boxShadow: UI_SHADOW,
      fontFamily: UI_FONT_FAMILY,
      zIndex: 100, // Ensure hotbar can be dropped onto
    }}>
      {Array.from({ length: numSlots }).map((_, index) => {
        const populatedItem = findItemForSlot(index);
        const currentSlotInfo: DragSourceSlotInfo = { type: 'hotbar', index: index };

        return (
          <DroppableSlot
            key={`hotbar-${index}`}
            slotInfo={currentSlotInfo}
            onItemDrop={onItemDrop}
            // Use a generic slot style class if available, or rely on inline style
            className={undefined} // Example: styles.slot if imported
            onClick={() => handleSlotClick(index)}
            style={{ // Apply Hotbar specific layout/border styles here
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: `${SLOT_SIZE}px`,
                height: `${SLOT_SIZE}px`,
                border: `2px solid ${index === selectedSlot ? SELECTED_BORDER_COLOR : UI_BORDER_COLOR}`,
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '3px',
                marginLeft: index > 0 ? `${SLOT_MARGIN}px` : '0px',
                transition: 'border-color 0.1s ease-in-out',
                boxSizing: 'border-box',
                cursor: 'pointer',
            }}
            isDraggingOver={false} // TODO: Logic needed
          >
            {/* Slot Number */}
            <span
                style={{ position: 'absolute', bottom: '2px', right: '4px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)', userSelect: 'none', pointerEvents: 'none'}}
            >
              {index + 1}
            </span>

            {/* Render Draggable Item if present */}
            {populatedItem && (
                <DraggableItem
                    item={populatedItem}
                    sourceSlot={currentSlotInfo}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    // Pass the NEW hotbar-specific context menu handler
                    onContextMenu={(event) => handleHotbarItemContextMenu(event, populatedItem)}
                 />
            )}
          </DroppableSlot>
        );
      })}
    </div>
  );
};

export default Hotbar; 