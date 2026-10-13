// A QR code as a square grid of modules — `components/QrCode` draws it. PURE.
import { utf8ToBytes } from '../../backup/envelope';
import { toQR } from './toqr';  // vendored plain JS

export type QrMatrix = { size: number; modules: Uint8Array };

/** Error correction M (~15%): sturdy enough for a phone screen scanned in dim light. */
const EC_MEDIUM = 0;

export function qrMatrix(text: string): QrMatrix {
  const modules: Uint8Array = toQR(utf8ToBytes(text), EC_MEDIUM);
  return { size: Math.round(Math.sqrt(modules.length)), modules };
}
