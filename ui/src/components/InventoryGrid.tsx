import { useEffect, useState } from 'react'
import { emitIntent, onInventoryChange, type InventorySlot } from 'client'

const GRID_COLUMNS = 4
const GRID_ROWS = 5
const SLOT_COUNT = GRID_COLUMNS * GRID_ROWS

const ITEM_COLORS: Record<string, string> = {
  health_potion: '#e05252',
  iron_sword: '#9aa5b1',
}

function itemLabel(itemId: string): string {
  return itemId
    .split('_')
    .map((word) => word[0]?.toUpperCase())
    .join('')
}

function InventoryGrid() {
  const [isOpen, setIsOpen] = useState(false)
  const [slots, setSlots] = useState<Map<number, InventorySlot>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)

  useEffect(
    () =>
      onInventoryChange((incoming) => {
        setSlots(new Map(incoming.map((slot) => [slot.slotIndex, slot])))
      }),
    [],
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'i') {
        setIsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function handleSlotClick(slotIndex: number) {
    if (selectedSlot === null) {
      if (slots.has(slotIndex)) {
        setSelectedSlot(slotIndex)
      }
      return
    }

    if (selectedSlot === slotIndex) {
      setSelectedSlot(null)
      return
    }

    emitIntent({ type: 'move_item', fromSlot: selectedSlot, toSlot: slotIndex })
    setSelectedSlot(null)
  }

  return (
    <>
      <button type="button" className="inventory-toggle" onClick={() => setIsOpen((open) => !open)}>
        Inventory (I)
      </button>

      {isOpen && (
        <div className="inventory-panel">
          <div className="inventory-grid">
            {Array.from({ length: SLOT_COUNT }, (_, slotIndex) => {
              const item = slots.get(slotIndex)
              return (
                <button
                  type="button"
                  key={slotIndex}
                  className={`inventory-slot${selectedSlot === slotIndex ? ' selected' : ''}`}
                  onClick={() => handleSlotClick(slotIndex)}
                >
                  {item && (
                    <>
                      <span className="inventory-item" style={{ background: ITEM_COLORS[item.itemId] ?? '#666' }}>
                        {itemLabel(item.itemId)}
                      </span>
                      {item.quantity > 1 && <span className="inventory-quantity">{item.quantity}</span>}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

export default InventoryGrid
