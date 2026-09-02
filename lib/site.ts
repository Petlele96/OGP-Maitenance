export const WHATSAPP_DISPLAY = "079 533 5440";
export const WHATSAPP_LINK = "https://wa.me/27795335440";
export const COMPANY_NAME = "OGP Services (Pty) Ltd";
export const COMPANY_REG = "2019/343931/07";
export const COMPANY_CSD = "MAAA130064";
export const LAUNCH_OFFER_SPOTS = 50;

/** "0821234567" -> "27821234567", matching wa.me's expected format. */
function toWhatsAppInternational(localNumber: string): string {
  return localNumber.replace(/^0/, "27");
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

/** Sent from the ops Today list, once a once-off job is marked done - pitches the monthly plan. */
export function buildFollowUpMessage(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  return `Hi ${firstName}, OGP Services here. We've finished your yard today — hope you're happy with it. If you'd like it kept this way, our monthly plan is R200 and we come twice a month. Just reply and I'll set you up.`;
}

export function buildFollowUpLink(fullName: string, whatsappNumber: string): string {
  const message = buildFollowUpMessage(fullName);
  return `https://wa.me/${toWhatsAppInternational(whatsappNumber)}?text=${encodeURIComponent(message)}`;
}
