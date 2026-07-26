// =============================================================================
// recapExport — renders the monthly report to a PDF on-device and DOWNLOADS it
// (saves to a user-visible location). Zero server cost, nothing leaves the
// device. On Android the user picks a folder via the Storage Access Framework;
// iOS has no public Downloads dir, so we hand it to the share sheet whose
// "Save to Files" is the platform-native way to keep a copy.
//
// Follows exportService.ts's lazy-require pattern: expo-print / expo-sharing /
// expo-file-system are required at call-time, never at module load, so a stale
// native binary can't crash the screen at bundle init.
// =============================================================================

import { buildMonthlyReportHtml, type MonthlyReport } from '../utils/monthlyReportHtml';

export interface RecapExportResult { outcome: 'saved' | 'shared'; location?: string; }

/**
 * Build the month's PDF and save it to the device (download).
 * @throws if printing/saving is unavailable — callers should catch and toast.
 */
export async function exportMonthlyRecap(report: MonthlyReport, userName?: string): Promise<RecapExportResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Print = require('expo-print');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FS = require('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require('react-native');

  const generatedOn = `${report.monthLabel} · generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const html = buildMonthlyReportHtml(report, { userName, generatedOn });

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const base = `ePurse-${report.monthKey}`;
  const mimeType = 'application/pdf';

  const share = async (from: string): Promise<RecapExportResult> => {
    await Sharing.shareAsync(from, { mimeType, dialogTitle: `Save ${report.monthLabel} report`, UTI: 'com.adobe.pdf' });
    return { outcome: 'shared' };
  };

  // ── Android: write into a user-picked folder (Downloads/Documents…) via SAF ──
  const SAF = FS.StorageAccessFramework;
  if (Platform.OS === 'android' && SAF) {
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) return share(uri); // user dismissed picker → still do something useful
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    const destUri = await SAF.createFileAsync(perm.directoryUri, base, mimeType);
    await FS.writeAsStringAsync(destUri, b64, { encoding: FS.EncodingType.Base64 });
    return { outcome: 'saved', location: 'your selected folder' };
  }

  // ── iOS / SAF unavailable → share sheet ("Save to Files") ──
  const dest = `${FS.cacheDirectory}${base}.pdf`;
  try {
    await FS.moveAsync({ from: uri, to: dest });
    return share(dest);
  } catch {
    return share(uri);
  }
}
