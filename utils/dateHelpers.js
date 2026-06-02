// utils/dateHelpers.js
// Centralized date formatting utilities for Asia/Colombo timezone display.
// Internal processing uses UTC (enforced by process.env.TZ = 'UTC' in server.js).
// All response/display formatting converts to Asia/Colombo for end users.

const SL_TIMEZONE = 'Asia/Colombo';

/**
 * Format a date as a localized date string in Asia/Colombo timezone.
 * Output: "01/06/2025" (en-GB format)
 */
export function formatDateSL(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', { timeZone: SL_TIMEZONE });
}

/**
 * Format a date with time in Asia/Colombo timezone.
 * Output: "01 Jun 2025, 14:30" (en-GB format)
 */
export function formatDateTimeSL(date, options = {}) {
  if (!date) return '-';
  const defaultOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: SL_TIMEZONE,
    ...options,
  };
  return new Date(date).toLocaleString('en-GB', defaultOptions);
}

/**
 * Get month abbreviation + year in Asia/Colombo timezone.
 * Output: "Jun 25"
 */
export function formatMonthKeySL(date) {
  if (!date) return '';
  const d = new Date(date);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: SL_TIMEZONE });
  const year = d.toLocaleDateString('en-US', { year: '2-digit', timeZone: SL_TIMEZONE });
  return `${month} ${year}`;
}

/**
 * Get short month name in Asia/Colombo timezone.
 * Output: "jun"
 */
export function formatMonthShortSL(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-US', { month: 'short', timeZone: SL_TIMEZONE }).toLowerCase();
}

/**
 * Format date for PDF / voucher: "01/06/2025" (en-GB)
 */
export function formatDateGB(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', { timeZone: SL_TIMEZONE });
}

export { SL_TIMEZONE };
