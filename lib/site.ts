import { PLANS, type PlanId } from "./plans";

export const WHATSAPP_DISPLAY = "073 262 2179";
export const WHATSAPP_LINK = "https://wa.me/27732622179";
export const COMPANY_NAME = "OGP Services (Pty) Ltd";
export const COMPANY_REG = "2019/343931/07";
export const COMPANY_CSD = "MAAA130064";

/** "0821234567" -> "27821234567", matching wa.me's expected format. */
function toWhatsAppInternational(localNumber: string): string {
  return localNumber.replace(/^0/, "27");
}

/** Plain "open a chat" link, no pre-filled text - every tappable customer number in the app uses this. */
export function buildWhatsAppChatLink(whatsappNumber: string): string {
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}`;
}

/** "Monthly plan" / "Annual plan", but just "Once-off visit" - that label already reads fine alone. */
export function planPhrase(id: PlanId): string {
  return id === "once-off" ? PLANS[id].label : `${PLANS[id].label} plan`;
}

/** Sent from the ops "Tomorrow" list, the evening before a visit. */
export function buildReminderMessage(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, OGP Services here. We're doing your yard tomorrow. Please make sure the gate is unlocked and any dogs are secured. Also pick up anything small from the grass. Thank you.`;
}

export function buildReminderLink(fullName: string, whatsappNumber: string): string {
  const message = buildReminderMessage(fullName);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}

/** "Ask a question" button on the signup page - opens WhatsApp to the business number. */
export const ASK_QUESTION_LINK = `${WHATSAPP_LINK}?text=${encodeURIComponent(
  "Hi OGP Services, I have a question about yard maintenance."
)}`;

/** "Report a problem" button on the signup page footer - opens WhatsApp to the business number. */
export const REPORT_PROBLEM_LINK = `${WHATSAPP_LINK}?text=${encodeURIComponent(
  "Hi OGP Services, I'd like to report a problem with my yard service. House number: "
)}`;

/** Sent from the ops Today list, once a once-off job is marked done - pitches the monthly plan. */
export function buildFollowUpMessage(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, OGP Services here. We've finished your yard today — hope you're happy with it. If you'd like it kept this way, our monthly plan is R200 and we come twice a month. Just reply and I'll set you up.`;
}

export function buildFollowUpLink(fullName: string, whatsappNumber: string): string {
  const message = buildFollowUpMessage(fullName);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}

/** Sent from the owner dashboard's unpaid list, to chase a failed or overdue payment. */
export function buildChaseMessage(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, OGP Services here. We're following up on this month's payment for your yard service - could you let us know when we can expect it? Thank you.`;
}

export function buildChaseLink(fullName: string, whatsappNumber: string): string {
  const message = buildChaseMessage(fullName);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}

/** Sent from the owner dashboard once, right after a new signup goes active - includes the
 * customer's private tracking-page link (item 1 of the tracking build), sent this once
 * rather than on every future contact. */
export function buildWelcomeMessage(fullName: string, serviceDayLabel: string, trackingUrl: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, thanks for signing up with OGP Services. Your yard is scheduled for ${serviceDayLabel}. We'll WhatsApp you the day before each visit so you can unlock the gate and secure any dogs. You can check your service day and visit history anytime here: ${trackingUrl}\n\nAny questions, just reply here.`;
}

export function buildWelcomeLink(
  fullName: string,
  whatsappNumber: string,
  serviceDayLabel: string,
  trackingUrl: string
): string {
  const message = buildWelcomeMessage(fullName, serviceDayLabel, trackingUrl);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}

/** Sent after a visit is moved, from the ops list, the owner calendar, or the customer profile. */
export function buildDateChangedMessage(fullName: string, newDateLabel: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, OGP Services here. Your yard is now booked for ${newDateLabel}.`;
}

export function buildDateChangedLink(fullName: string, whatsappNumber: string, newDateLabel: string): string {
  const message = buildDateChangedMessage(fullName, newDateLabel);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}

/** Sent from the ops "Booked" tab's "Send payment link" button. */
export function buildPaymentLinkMessage(fullName: string, planId: PlanId, payUrl: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, OGP Services here. Ready to start your ${planPhrase(planId)}? Complete your payment here: ${payUrl}\n\nThis link expires in 7 days.`;
}

export function buildPaymentLinkLink(
  fullName: string,
  whatsappNumber: string,
  planId: PlanId,
  payUrl: string
): string {
  const message = buildPaymentLinkMessage(fullName, planId, payUrl);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}
