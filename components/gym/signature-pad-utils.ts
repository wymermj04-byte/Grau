export type SignaturePoint = { x: number; y: number };
export type SignatureStroke = SignaturePoint[];
export type SignaturePadSize = { width: number; height: number };

type GestureCoordinateEvent = {
  nativeEvent?: {
    locationX?: unknown;
    locationY?: unknown;
  } | null;
} | null | undefined;

function clamp(value: number, maximum: number) {
  return Math.min(Math.max(0, value), Math.max(0, maximum));
}

// Read React Native's event values synchronously. Gesture event objects may no
// longer expose their native fields once a deferred state updater runs.
export function copyRelativePadPoint(
  event: GestureCoordinateEvent,
  size: SignaturePadSize,
): SignaturePoint | null {
  const nativeEvent = event?.nativeEvent;
  const locationX = nativeEvent?.locationX;
  const locationY = nativeEvent?.locationY;

  if (
    typeof locationX !== 'number'
    || typeof locationY !== 'number'
    || !Number.isFinite(locationX)
    || !Number.isFinite(locationY)
  ) {
    return null;
  }

  return {
    x: clamp(locationX, size.width),
    y: clamp(locationY, size.height),
  };
}

export function appendPointToActiveStroke(
  strokes: SignatureStroke[],
  point: SignaturePoint | null,
): SignatureStroke[] {
  if (!point || strokes.length === 0) return strokes;

  const lastIndex = strokes.length - 1;
  return [
    ...strokes.slice(0, lastIndex),
    [...strokes[lastIndex], point],
  ];
}

export function hasDrawnSignature(strokes: SignatureStroke[]) {
  return strokes.some((stroke) => stroke.length > 1);
}
