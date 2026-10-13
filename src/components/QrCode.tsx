// A QR code drawn with react-native-svg (utils/qr). Always dark-on-white with the
// standard 4-module quiet zone, whatever the theme — scanners need the contrast.
import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix } from '../utils/qr';

const QUIET = 4;

export default function QrCode({ value, size, accessibilityLabel }: { value: string; size: number; accessibilityLabel?: string }) {
  const { path, extent } = useMemo(() => {
    const m = qrMatrix(value);
    let d = '';
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (m.modules[y * m.size + x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    return { path: d, extent: m.size + QUIET * 2 };
  }, [value]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${extent} ${extent}`} accessibilityLabel={accessibilityLabel} accessibilityRole="image">
      <Rect width={extent} height={extent} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
