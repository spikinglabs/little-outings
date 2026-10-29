// What a family has typed into a form, kept for this tab only (sessionStorage), so a trip to Profile
// or an accidental back swipe doesn't throw it away. Dropped once the form is sent.

type Values = Record<string, string | string[]>;
const k = (key: string) => `lo-draft-${key}`;

export function loadDraft<T = Values>(key: string): T | null {
  try { const s = sessionStorage.getItem(k(key)); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}

export function saveDraft(key: string, value: unknown) {
  try { sessionStorage.setItem(k(key), JSON.stringify(value)); } catch { /* storage blocked */ }
}

export function dropDraft(key: string) {
  try { sessionStorage.removeItem(k(key)); } catch { /* storage blocked */ }
}

/** A form's named fields; checkboxes come back as lists. The nickname isn't part of a draft. */
export function formValues(form: HTMLFormElement): Values {
  const out: Values = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name || el.name === "by" || el.type === "file" || el.type === "hidden") continue;
    if (el.type === "checkbox") out[el.name] = [...((out[el.name] as string[]) ?? []), ...(el.checked ? [el.value] : [])];
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

/** Puts saved values back; empty means the form had nothing worth keeping. */
export function fillForm(form: HTMLFormElement, values: Values) {
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    const v = values[el.name];
    if (!el.name || v === undefined) continue;
    if (el.type === "checkbox") el.checked = (v as string[]).includes(el.value);
    else if (el.type === "radio") el.checked = el.value === v;
    else el.value = v as string;
  }
}

export const hasText = (values: Values) => Object.values(values).some((v) => (Array.isArray(v) ? v.length > 0 : v.trim() !== ""));
