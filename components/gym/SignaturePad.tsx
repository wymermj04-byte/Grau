import * as React from 'react';
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { useTheme } from '@/theming/ThemeProvider';
import {
  appendPointToActiveStroke,
  copyRelativePadPoint,
  hasDrawnSignature,
  type SignaturePadSize,
  type SignatureStroke,
} from '@/components/gym/signature-pad-utils';

type SignaturePadProps = {
  onChange: (signatureSvg: string | null) => void;
  onGestureStateChange?: (isDrawing: boolean) => void;
};

function pathForStroke(stroke: SignatureStroke) {
  return stroke.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

const styles = StyleSheet.create({
  drawingSurface: {
    height: 176,
  },
  prompt: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visuallyHiddenPrompt: {
    opacity: 0,
  },
  disabledClear: {
    opacity: 0.4,
  },
});

export function SignaturePad({ onChange, onGestureStateChange }: SignaturePadProps) {
  const { theme } = useTheme();
  const [strokes, setStrokes] = React.useState<SignatureStroke[]>([]);
  const [size, setSize] = React.useState<SignaturePadSize>({ width: 320, height: 176 });
  const sizeRef = React.useRef(size);
  const isDrawingRef = React.useRef(false);

  React.useEffect(() => {
    const hasSignature = hasDrawnSignature(strokes);
    if (!hasSignature) {
      onChange(null);
      return;
    }
    const paths = strokes.filter((stroke) => stroke.length > 1).map((stroke) => `<path d="${pathForStroke(stroke)}" fill="none" stroke="#171B1A" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>`).join('');
    onChange(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="Handwritten signature">${paths}</svg>`);
  }, [onChange, size.height, size.width, strokes]);

  const setDrawingState = React.useCallback((isDrawing: boolean) => {
    if (isDrawingRef.current === isDrawing) return;
    isDrawingRef.current = isDrawing;
    onGestureStateChange?.(isDrawing);
  }, [onGestureStateChange]);

  React.useEffect(() => () => {
    setDrawingState(false);
  }, [setDrawingState]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      setDrawingState(true);
      const point = copyRelativePadPoint(event, sizeRef.current);
      if (!point) return;
      setStrokes((current) => [...current, [point]]);
    },
    onPanResponderMove: (event) => {
      const point = copyRelativePadPoint(event, sizeRef.current);
      if (!point) return;
      setStrokes((current) => appendPointToActiveStroke(current, point));
    },
    onPanResponderRelease: () => setDrawingState(false),
    onPanResponderTerminate: () => setDrawingState(false),
  }), [setDrawingState]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      const nextSize = { width, height };
      sizeRef.current = nextSize;
      setSize(nextSize);
    }
  };
  const hasSignature = hasDrawnSignature(strokes);

  return <View className="overflow-hidden rounded-2xl border border-border bg-background">
    <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
      <Text className="font-bold text-foreground">Signature</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear signature"
        disabled={!hasSignature}
        onPress={() => setStrokes([])}
        className="min-h-11 min-w-11 flex-row items-center justify-center gap-1 rounded-xl px-2 active:bg-accent"
        style={!hasSignature ? styles.disabledClear : undefined}
      >
        <LucideIcon name="Trash2" className="h-4 w-4 text-muted-foreground" />
        <Text className="text-sm font-semibold text-muted-foreground">Clear</Text>
      </Pressable>
    </View>
    <View
      accessibilityRole="image"
      accessibilityLabel="Signature area. Sign with a finger, mouse, or stylus."
      onLayout={onLayout}
      {...panResponder.panHandlers}
      style={[styles.drawingSurface, { backgroundColor: theme.colors.card }]}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} pointerEvents="none">
        {strokes.filter((stroke) => stroke.length > 1).map((stroke, index) => <Path key={index} d={pathForStroke(stroke)} fill="none" stroke={theme.colors.foreground} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />)}
      </Svg>
      <View
        pointerEvents="none"
        accessibilityElementsHidden={hasSignature}
        importantForAccessibility={hasSignature ? 'no-hide-descendants' : 'auto'}
        style={[styles.prompt, hasSignature ? styles.visuallyHiddenPrompt : undefined]}
      >
        <Text className="text-sm text-muted-foreground">Sign here</Text>
      </View>
    </View>
  </View>;
}
