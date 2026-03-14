/**
 * Email service abstraction for transactional emails.
 *
 * Supports multiple backends:
 * - SMTP (via Nodemailer) — default, works with any SMTP provider
 * - AWS SES (via Nodemailer SES transport) — set SMTP_HOST=email-smtp.<region>.amazonaws.com
 * - Console/log (dev fallback when no SMTP configured)
 *
 * HIPAA: Never include PHI (call content, transcripts) in emails.
 * Only send metadata: tokens, user names, org names, links.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "./logger";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;
let fromAddress: string = "noreply@observatory-qa.com";

/**
 * Initialize the email transport. Call once at startup.
 * Returns true if a real SMTP transport was configured.
 */
export function initEmail(): boolean {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  fromAddress = process.env.SMTP_FROM || fromAddress;

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — emails will be logged to console only");
    return false;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  logger.info({ host, port, from: fromAddress }, "Email transport initialized");
  return true;
}

/**
 * Send a transactional email.
 * Falls back to logging when no transport is configured.
 * Non-blocking — failures are logged but never throw.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const { to, subject, text, html } = options;

  if (!transporter) {
    // Dev fallback: log the email content
    logger.info(
      { to, subject, textLength: text.length },
      `[EMAIL-DEV] Would send email: "${subject}" to ${to}`,
    );
    return true;
  }

  try {
    await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text,
      html,
    });
    logger.info({ to, subject }, "Email sent");
    return true;
  } catch (error) {
    logger.error({ err: error, to, subject }, "Failed to send email");
    return false;
  }
}

// --- Email templates ---

export function buildPasswordResetEmail(
  resetUrl: string,
  userName: string,
  orgName: string,
): EmailOptions {
  const subject = `Password Reset — ${orgName}`;
  const text = [
    `Hi ${userName},`,
    "",
    `You requested a password reset for your ${orgName} account.`,
    "",
    `Click the link below to reset your password (valid for 1 hour):`,
    resetUrl,
    "",
    "If you didn't request this, you can safely ignore this email.",
    "",
    `— ${orgName} Team`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Password Reset</h2>
      <p>Hi ${escapeHtml(userName)},</p>
      <p>You requested a password reset for your <strong>${escapeHtml(orgName)}</strong> account.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(resetUrl)}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This link is valid for 1 hour. If you didn't request this, ignore this email.</p>
    </div>
  `;

  return { to: "", subject, text, html };
}

export function buildInvitationEmail(
  inviteUrl: string,
  orgName: string,
  invitedByName: string,
  role: string,
): EmailOptions {
  const subject = `You're invited to ${orgName}`;
  const text = [
    `${invitedByName} has invited you to join ${orgName} as a ${role}.`,
    "",
    `Click the link below to accept your invitation:`,
    inviteUrl,
    "",
    "This invitation expires in 7 days.",
    "",
    `— ${orgName} Team`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">You're Invited</h2>
      <p><strong>${escapeHtml(invitedByName)}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> as a <strong>${escapeHtml(role)}</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(inviteUrl)}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Accept Invitation
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
    </div>
  `;

  return { to: "", subject, text, html };
}

export function buildFlaggedCallEmail(
  callId: string,
  flags: string[],
  performanceScore: number | undefined,
  agentName: string | undefined,
  fileName: string | undefined,
  summary: string | undefined,
  orgName: string,
  dashboardUrl: string,
): EmailOptions {
  const flagLabels = flags.map(f => {
    if (f === "low_score") return "Low Score";
    if (f === "exceptional_call") return "Exceptional Call";
    if (f.startsWith("agent_misconduct")) return `Misconduct: ${f.split(":")[1] || "unspecified"}`;
    return f;
  });
  const isGood = flags.includes("exceptional_call") && !flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
  const scoreText = performanceScore != null ? `${performanceScore.toFixed(1)}/10` : "N/A";
  const emoji = isGood ? "Star" : "Alert";

  const subject = `[${orgName}] Call Flagged: ${flagLabels.join(", ")} — Score: ${scoreText}`;
  const callUrl = `${dashboardUrl}/transcripts/${callId}`;

  const text = [
    `${emoji === "Star" ? "Exceptional" : "Flagged"} Call — ${orgName}`,
    "",
    `Flags: ${flagLabels.join(", ")}`,
    `Score: ${scoreText}`,
    ...(agentName ? [`Agent: ${agentName}`] : []),
    ...(fileName ? [`File: ${fileName}`] : []),
    ...(summary ? ["", `Summary: ${summary.slice(0, 500)}`] : []),
    "",
    `View call: ${callUrl}`,
    "",
    `— ${orgName} QA Platform`,
  ].join("\n");

  const flagColor = isGood ? "#10b981" : "#ef4444";
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto;">
      <div style="border-left: 4px solid ${flagColor}; padding-left: 16px; margin-bottom: 16px;">
        <h2 style="color: #1a1a1a; margin: 0 0 4px;">Call Flagged: ${escapeHtml(flagLabels.join(", "))}</h2>
        <p style="color: #666; font-size: 14px; margin: 0;">${escapeHtml(orgName)}</p>
      </div>
      <table style="font-size: 14px; border-collapse: collapse;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666; font-weight: 600;">Score</td><td>${escapeHtml(scoreText)}</td></tr>
        ${agentName ? `<tr><td style="padding: 4px 12px 4px 0; color: #666; font-weight: 600;">Agent</td><td>${escapeHtml(agentName)}</td></tr>` : ""}
        ${fileName ? `<tr><td style="padding: 4px 12px 4px 0; color: #666; font-weight: 600;">File</td><td>${escapeHtml(fileName)}</td></tr>` : ""}
      </table>
      ${summary ? `<p style="font-size: 14px; color: #333; margin-top: 12px;">${escapeHtml(summary.slice(0, 500))}</p>` : ""}
      <p style="margin: 20px 0;">
        <a href="${escapeHtml(callUrl)}" style="background: ${flagColor}; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">
          View Call Details
        </a>
      </p>
    </div>
  `;

  return { to: "", subject, text, html };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
