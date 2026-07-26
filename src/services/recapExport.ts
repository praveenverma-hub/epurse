// =============================================================================
// recapExport — renders the monthly report to a PDF on-device and hands it to
// the OS share sheet. Zero server cost, nothing leaves the device unless the
// user chooses a share target (Save to Files, Gmail, WhatsApp, Drive…).
//
// Follows exportService.ts's lazy-require pattern: expo-print / expo-sharing /
// expo-file-system are required at call-time, never at module load, so a stale
// native binary can't crash the screen at bundle init.
// =============================================================================

import { buildMonthlyReportHtml, type MonthlyReport } from '../utils/monthlyReportHtml';

export interface RecapExportResult { outcome: 'shared'; }

/**
 * Build the month's PDF and open the share sheet.
 * @throws if printing/sharing is unavailable — callers should catch and toast.
 */
export async function exportMonthlyRecap(report: MonthlyReport, userName?: string): Promise<RecapExportResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Print = require('expo-print');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FS = require('expo-file-system');

  const generatedOn = `${report.monthLabel} · generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const html = buildMonthlyReportHtml(report, { userName, generatedOn });

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  // Give the file a human name (share targets and Files use it verbatim).
  const base = `ePurse-${report.monthKey}`;
  const dest = `${FS.cacheDirectory}${base}.pdf`;
  try {
    await FS.moveAsync({ from: uri, to: dest });
  } catch {
    // If a same-named cache file exists, fall back to sharing the raw uri.
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share monthly report', UTI: 'com.adobe.pdf' });
    return { outcome: 'shared' };
  }

  await Sharing.shareAsync(dest, {
    mimeType: 'application/pdf',
    dialogTitle: `Share ${report.monthLabel} report`,
    UTI: 'com.adobe.pdf',
  });
  return { outcome: 'shared' };
}
