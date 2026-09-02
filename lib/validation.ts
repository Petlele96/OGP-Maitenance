import { z } from "zod";
import { MIN_BLOCK, MAX_BLOCK } from "./sort";

// South African mobile numbers: 0821234567, +27821234567, or 27821234567
const SA_MOBILE_REGEX = /^(0|27|\+27)[6-8][0-9]{8}$/;

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(120)
    .regex(/\s/, "Enter your first and last name"),
  houseNumber: z.string().trim().min(1, "Enter your house number").max(50),
  whatsappNumber: z
    .string()
    .trim()
    .regex(SA_MOBILE_REGEX, "Enter a valid South African cell number"),
  plan: z.enum(["monthly", "annual", "once-off"]),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the Terms and Conditions" }),
  }),
  // Not compulsory - some streets have no name, some tenants don't know theirs.
  block: z.number().int().min(MIN_BLOCK).max(MAX_BLOCK).nullable().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

export function normalizeCellNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("27")) return `0${digits.slice(2)}`;
  return digits;
}
