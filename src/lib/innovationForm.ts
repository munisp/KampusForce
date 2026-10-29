import { useState, type FormEvent } from "react";

export function useActionSuccess() {
  const [message, setMessage] = useState("");
  return { message, show: setMessage, clear: () => setMessage("") };
}

export function formValue(form: FormEvent<HTMLFormElement>, key: string) {
  return String(new FormData(form.currentTarget).get(key) || "").trim();
}

export function formNumber(form: FormEvent<HTMLFormElement>, key: string) {
  return Number(formValue(form, key));
}

export function formDate(form: FormEvent<HTMLFormElement>, key: string) {
  return new Date(formValue(form, key));
}

export function formJson(form: FormEvent<HTMLFormElement>, key: string): Record<string, unknown> {
  const value = JSON.parse(formValue(form, key));
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Enter a JSON object, not an array or scalar.");
  return value as Record<string, unknown>;
}

export function localDateInput(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function dayInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
