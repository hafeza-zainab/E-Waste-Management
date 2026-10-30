import { z } from "zod";
import { DEVICE_TYPES } from "@/lib/ai/schemas";
import { PASSWORD_MAX } from "./constants";
import { passwordProblem } from "./password";

/** Trimmed, NFKC-normalised, lower-cased. */
export const normalizeEmail = (raw: string) => raw.normalize("NFKC").trim().toLowerCase();

/** ASCII addresses only: plus tags are fine; non-ASCII addresses get a clear message. */
export const EmailSchema = z
  .string({ error: "Enter your email." })
  .max(254, "That email is too long.")
  .transform(normalizeEmail)
  .pipe(z.string().min(1, "Enter your email.").regex(/^[\x21-\x7e]+$/, "Use an email with plain letters and numbers only.").pipe(z.email("Enter a valid email address.")));

const NameSchema = z
  .string({ error: "Enter your name." })
  .max(200, "That name is too long.")
  .transform((s) => s.normalize("NFKC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Enter your name.").max(80, "Use at most 80 characters.").regex(/^[^\u0000-\u001f\u007f<>]+$/, "That name has characters we can't accept."));

const PasswordField = z.string({ error: "Enter a password." }).max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
  next: z.string().max(500).optional(),
});

const TechFields = {
  skills: z.array(z.enum(DEVICE_TYPES)).min(1, "Choose at least one device type.").max(DEVICE_TYPES.length),
  area: z
    .string({ error: "Enter your area." })
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2, "Enter your city or area.").max(80, "Use at most 80 characters.").regex(/^[^\u0000-\u001f\u007f<>]+$/, "That area has characters we can't accept.")),
  payoutEmail: EmailSchema,
};

export const SignupSchema = z
  .discriminatedUnion("role", [
    z.object({ role: z.literal("owner"), name: NameSchema, email: EmailSchema, password: PasswordField, next: z.string().max(500).optional() }),
    z.object({ role: z.literal("technician"), name: NameSchema, email: EmailSchema, password: PasswordField, next: z.string().max(500).optional(), ...TechFields }),
  ])
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.password, { email: v.email, name: v.name });
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
  });
export type SignupInput = z.infer<typeof SignupSchema>;

/** field -> first message, for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}
