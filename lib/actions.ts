"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_COOKIE, TECH_COOKIE } from "@/lib/session";

export async function switchRole(formData: FormData) {
  const role = formData.get("role") === "technician" ? "technician" : "owner";
  const jar = await cookies();
  jar.set(ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  const techId = formData.get("techId");
  if (typeof techId === "string" && techId) {
    jar.set(TECH_COOKIE, techId, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  }
  redirect(role === "technician" ? "/technician" : "/owner");
}
