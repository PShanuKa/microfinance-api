// utils/reportCron.js
import { excelExportService } from "../services/excelExportService.js";
import { sendEmail } from "../services/emailService.js";

/**
 * Process scheduled reports based on ReportSettings.
 * Called by the cron scheduler.
 */
export async function processScheduledReports(prisma, log) {
  // 1. Read settings
  const settings = await prisma.reportSettings.findUnique({
    where: { id: "default" },
  });

  if (!settings || !settings.emailEnabled) {
    log.info("[REPORT-CRON] Report emails disabled or no settings found. Skipping.");
    return { sent: false, reason: "disabled" };
  }

  const emails = Array.isArray(settings.reportEmails) ? settings.reportEmails : [];
  if (emails.length === 0) {
    log.info("[REPORT-CRON] No recipient emails configured. Skipping.");
    return { sent: false, reason: "no_recipients" };
  }

  // 2. Calculate date range
  const now = new Date();
  let startDate, endDate, periodLabel;

  if (settings.reportFrequency === "WEEKLY") {
    // Previous week: Mon–Sun
    const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
    const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysToLastMonday - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);

    startDate = lastMonday.toISOString().split("T")[0];
    endDate = lastSunday.toISOString().split("T")[0];
    periodLabel = `Weekly Report (${startDate} to ${endDate})`;
  } else {
    // Previous month
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);

    startDate = prevMonth.toISOString().split("T")[0];
    endDate = lastDay.toISOString().split("T")[0];
    periodLabel = `Monthly Report (${startDate} to ${endDate})`;
  }

  log.info(`[REPORT-CRON] Generating ${periodLabel} for ${emails.length} recipient(s)...`);

  // 3. Generate reports
  const attachments = [];

  try {
    const collectionsBuffer = await excelExportService.generateCollectionsReport(prisma, startDate, endDate);
    attachments.push({ filename: `Collections_Report_${startDate}_${endDate}.xlsx`, content: Buffer.from(collectionsBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate collections report"); }

  try {
    const officerBuffer = await excelExportService.generateCollectionsOfficerWiseReport(prisma, startDate, endDate);
    attachments.push({ filename: `Officer_Wise_Collections_${startDate}_${endDate}.xlsx`, content: Buffer.from(officerBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate officer-wise report"); }

  try {
    const completedBuffer = await excelExportService.generateCompletedLoansReport(prisma, startDate, endDate);
    attachments.push({ filename: `Completed_Loans_${startDate}_${endDate}.xlsx`, content: Buffer.from(completedBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate completed loans report"); }

  try {
    const propertyBuffer = await excelExportService.generatePropertyCollectionsReport(prisma, startDate, endDate);
    attachments.push({ filename: `Property_Collections_${startDate}_${endDate}.xlsx`, content: Buffer.from(propertyBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate property collections report"); }

  try {
    const overdueBuffer = await excelExportService.generateOverdueSummaryReport(prisma);
    attachments.push({ filename: `Overdue_Summary_${startDate}_${endDate}.xlsx`, content: Buffer.from(overdueBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate overdue summary report"); }

  try {
    const branchBuffer = await excelExportService.generateBranchPerformanceReport(prisma);
    attachments.push({ filename: `Branch_Performance_${startDate}_${endDate}.xlsx`, content: Buffer.from(branchBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate branch performance report"); }

  try {
    const disbursementBuffer = await excelExportService.generateDisbursementReport(prisma, startDate, endDate);
    attachments.push({ filename: `Disbursement_Report_${startDate}_${endDate}.xlsx`, content: Buffer.from(disbursementBuffer) });
  } catch (err) { log.error(err, "[REPORT-CRON] Failed to generate disbursement report"); }

  // 4. Send email
  if (attachments.length === 0) {
    log.warn("[REPORT-CRON] No reports generated. Skipping email.");
    return { sent: false, reason: "no_reports" };
  }

  const result = await sendEmail({
    to: emails,
    subject: `📊 Microfinance ${periodLabel}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1E293B;">📊 Microfinance ${periodLabel}</h2>
        <p style="color: #64748B;">This is an automated report for the period <strong>${startDate}</strong> to <strong>${endDate}</strong>.</p>
        <p style="color: #64748B;">The following reports are attached:</p>
        <ul style="color: #475569;">
          ${attachments.map((a) => `<li>${a.filename}</li>`).join("")}
        </ul>
        <hr style="border-color: #E2E8F0;" />
        <p style="color: #94A3B8; font-size: 12px;">This email was sent automatically by the Microfinance System.</p>
      </div>
    `,
    attachments,
  });

  if (result.success) {
    log.info(`[REPORT-CRON] Successfully sent ${attachments.length} report(s) to ${emails.join(", ")}`);
  } else {
    log.error(`[REPORT-CRON] Failed to send email: ${result.error}`);
  }

  return { sent: result.success, attachments: attachments.length, recipients: emails.length };
}
