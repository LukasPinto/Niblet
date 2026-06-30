const CARD_W = 380;
const MARGIN = 10;
/** Solape entre ancla y tarjeta para evitar huecos que disparen mouseout. */
const BRIDGE_OVERLAP = 6;
const BRIDGE_PAD = 12;

export interface CardPlacement {
  left: number;
  top: number;
  maxHeight: number;
  placement: "above" | "below";
}

export function computeCardPlacement(
  anchorRect: DOMRect,
  cardH: number,
  vw = window.innerWidth,
  vh = window.innerHeight,
): CardPlacement {
  let left = anchorRect.left;
  if (left + CARD_W > vw - MARGIN) left = vw - CARD_W - MARGIN;
  if (left < MARGIN) left = MARGIN;

  const spaceBelow = vh - anchorRect.bottom - MARGIN;
  const spaceAbove = anchorRect.top - MARGIN;
  const needed = Math.min(cardH, 220);

  const placement: "above" | "below" =
    spaceBelow < needed && spaceAbove > spaceBelow ? "above" : "below";

  let top: number;
  let maxHeight: number;

  if (placement === "below") {
    top = anchorRect.bottom - BRIDGE_OVERLAP;
    maxHeight = Math.min(420, Math.max(120, spaceBelow + BRIDGE_OVERLAP));
  } else {
    top = Math.max(MARGIN, anchorRect.top - cardH + BRIDGE_OVERLAP);
    maxHeight = Math.min(420, Math.max(120, spaceAbove + BRIDGE_OVERLAP));
  }

  return { left, top, maxHeight, placement };
}

export function isPointerInHoverZone(
  x: number,
  y: number,
  anchorEl: HTMLElement | null,
  cardEl: HTMLElement | null,
): boolean {
  if (!anchorEl?.isConnected) return false;

  const expand = (r: DOMRect, pad: number) => ({
    left: r.left - pad,
    right: r.right + pad,
    top: r.top - pad,
    bottom: r.bottom + pad,
  });

  const inRect = (
    px: number,
    py: number,
    r: { left: number; right: number; top: number; bottom: number },
  ) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;

  const anchor = expand(anchorEl.getBoundingClientRect(), BRIDGE_PAD);
  if (inRect(x, y, anchor)) return true;

  if (cardEl?.isConnected) {
    const card = expand(cardEl.getBoundingClientRect(), 4);
    if (inRect(x, y, card)) return true;

    // Puente vertical entre ancla y tarjeta.
    const bridge = {
      left: Math.min(anchor.left, card.left),
      right: Math.max(anchor.right, card.right),
      top: Math.min(anchor.top, card.top),
      bottom: Math.max(anchor.bottom, card.bottom),
    };
    if (inRect(x, y, bridge)) return true;
  }

  return false;
}

export const HOVER_CARD_WIDTH = CARD_W;

export function estimatePlacement(anchorEl: HTMLElement): CardPlacement {
  const rect = anchorEl.getBoundingClientRect();
  return computeCardPlacement(rect, 260);
}
