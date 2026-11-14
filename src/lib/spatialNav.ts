export type Direction = 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp';

const DIRECTIONS: readonly Direction[] = [
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
];

export function isArrowDirection(key: string): key is Direction {
  return DIRECTIONS.includes(key as Direction);
}

function isElementVisible(el: HTMLElement | SVGElement): boolean {
  if (typeof (el as Element & { checkVisibility?: () => boolean }).checkVisibility === 'function') {
    return (el as Element & { checkVisibility: () => boolean }).checkVisibility();
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Finds the best directional focus candidate from live DOM bounding rects.
 * Returns null if there is no valid candidate in the pressed direction,
 * allowing native viewport scrolling to proceed undisturbed.
 */
export function findSpatialCandidate(
  container: HTMLElement | SVGElement,
  current: HTMLElement | SVGElement,
  direction: Direction,
): (HTMLElement | SVGElement) | null {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement | SVGElement>('[data-seat-cell="true"]'),
  ).filter((el) => el !== current && isElementVisible(el));

  if (candidates.length === 0) return null;

  const curRect = current.getBoundingClientRect();
  const curCenterX = curRect.left + curRect.width / 2;
  const curCenterY = curRect.top + curRect.height / 2;
  const tolerance = 2;

  interface ScoredCandidate {
    el: HTMLElement | SVGElement;
    overlaps: boolean;
    gap: number;
    perpOffset: number;
  }

  const valid: ScoredCandidate[] = [];

  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const rCenterX = r.left + r.width / 2;
    const rCenterY = r.top + r.height / 2;

    let inDirection = false;
    let gap = Infinity;
    let overlaps = false;
    let perpOffset = 0;

    if (direction === 'ArrowRight') {
      inDirection = r.left >= curRect.right - tolerance;
      gap = Math.max(0, r.left - curRect.right);
      overlaps = r.bottom > curRect.top + tolerance && r.top < curRect.bottom - tolerance;
      perpOffset = Math.abs(rCenterY - curCenterY);
    } else if (direction === 'ArrowLeft') {
      inDirection = r.right <= curRect.left + tolerance;
      gap = Math.max(0, curRect.left - r.right);
      overlaps = r.bottom > curRect.top + tolerance && r.top < curRect.bottom - tolerance;
      perpOffset = Math.abs(rCenterY - curCenterY);
    } else if (direction === 'ArrowDown') {
      inDirection = r.top >= curRect.bottom - tolerance;
      gap = Math.max(0, r.top - curRect.bottom);
      overlaps = r.right > curRect.left + tolerance && r.left < curRect.right - tolerance;
      perpOffset = Math.abs(rCenterX - curCenterX);
    } else if (direction === 'ArrowUp') {
      inDirection = r.bottom <= curRect.top + tolerance;
      gap = Math.max(0, curRect.top - r.bottom);
      overlaps = r.right > curRect.left + tolerance && r.left < curRect.right - tolerance;
      perpOffset = Math.abs(rCenterX - curCenterX);
    }

    if (inDirection) {
      valid.push({ el, overlaps, gap, perpOffset });
    }
  }

  if (valid.length === 0) return null;

  const aligned = valid.filter((c) => c.overlaps);
  if (aligned.length > 0) {
    aligned.sort((a, b) => a.gap - b.gap || a.perpOffset - b.perpOffset);
    return aligned[0]!.el;
  }

  // Weighted fallback favoring closely aligned candidates
  const w = 2.5;
  valid.sort((a, b) => a.gap + w * a.perpOffset - (b.gap + w * b.perpOffset));
  return valid[0]!.el;
}
