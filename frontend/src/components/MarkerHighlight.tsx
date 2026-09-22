/**
 * MarkerHighlight — sketchpen highlight behind a tagline (graph titles).
 *
 * The text stays crisp and straight; only the highlighter behind it sits
 * crooked (slight rotation + wobbly double stroke), like a kid shading
 * with a sketchpen. Static (no motion), measured from the real text so
 * the shade always fits. Color defaults to highlighter yellow; pass a
 * metric hue to tie it to the graph.
 */

import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FONT } from '@/theme/guava';
import { MARKER_COLOR, scribblePaths } from '@/components/markerScribble';

export function MarkerHighlight({
  children,
  color = MARKER_COLOR,
  opacity = 0.5,
  textStyle,
  numberOfLines,
  center = false,
}: {
  children: string;
  color?: string;
  opacity?: number;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Center the shaded tagline (for centered headers). */
  center?: boolean;
}): React.JSX.Element {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const padX = 5;
  const padY = 4;
  const paths =
    box != null && box.w > 0
      ? scribblePaths(0, 0, box.w + padX * 2, box.h + padY * 2)
      : null;

  return (
    <View style={[styles.wrap, center && styles.wrapCenter]} accessibilityRole="text">
      {paths ? (
        <Svg
          style={[styles.scribble, { left: -padX, top: -padY - 1 }]}
          width={box!.w + padX * 2}
          height={box!.h + padY * 2 + 2}
          pointerEvents="none"
        >
          <Path
            d={paths.main}
            stroke={color}
            strokeWidth={paths.mainWidth}
            opacity={opacity}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d={paths.over}
            stroke={color}
            strokeWidth={paths.overWidth}
            opacity={opacity * 0.9}
            fill="none"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
      <Text
        style={[styles.text, textStyle]}
        numberOfLines={numberOfLines}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBox((prev) =>
            prev != null && Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5
              ? prev
              : { w: width, h: height },
          );
        }}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  wrapCenter: {
    alignSelf: 'center',
  },
  scribble: {
    position: 'absolute',
    transform: [{ rotate: '-1.5deg' }],
  },
  text: {
    fontFamily: FONT.semi,
  },
});

export default MarkerHighlight;
