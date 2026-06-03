// services/emailService.js
import nodemailer from "nodemailer";

/**
 * Creates a nodemailer transporter using SMTP config from environment.
 */
function createTransporter() {
  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT) || 587;
  const user = process.env.MAIL_USERNAME;
  const pass = process.env.MAIL_PASSWORD;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * Send an email with optional attachments.
 * @param {Object} opts
 * @param {string[]} opts.to - Array of recipient email addresses
 * @param {string} opts.subject - Email subject
 * @param {string} opts.html - HTML body
 * @param {Array<{filename: string, content: Buffer}>} [opts.attachments] - File attachments
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendEmail({ to, subject, html, attachments = [] }) {
  const transporter = createTransporter();

  if (!transporter) {
    return { success: false, error: "SMTP not configured" };
  }

  try {
    await transporter.sendMail({
      from: `"Microfinance Reports" <${process.env.MAIL_USERNAME}>`,
      to: to.join(", "),
      subject,
      html,
      attachments,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
