import { useLayoutEffect, useState } from "react";
import {
  computeCardPlacement,
  estimatePlacement,
  HOVER_CARD_WIDTH,
  type CardPlacement,
} from "../lib/hoverPreviewGeometry";

export function useHoverCardPosition(
  anchorEl: HTMLElement | null,
  visible: boolean,
  cardRef: React.RefObject<HTMLElement | null>,
): CardPlacement | null {
  const [pos, setPos] = useState<CardPlacement | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorEl) {
      setPos(null);
      return;
    }

    const measure = () => {
      if (!anchorEl.isConnected) {
        setPos(null);
        return;
      }
      const rect = anchorEl.getBoundingClientRect();
      const cardH = cardRef.current?.offsetHeight ?? 260;
      setPos(computeCardPlacement(rect, cardH));
    };

    measure();
    const ro = cardRef.current ? new ResizeObserver(measure) : null;
    if (cardRef.current) ro?.observe(cardRef.current);

    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);

    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchorEl, visible, cardRef]);

  return pos;
}

export { HOVER_CARD_WIDTH, estimatePlacement as estimateHoverCardPosition };
