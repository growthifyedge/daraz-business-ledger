// Shared result type for form server actions used with useActionState.
export interface FormState {
  ok?: boolean;
  error?: string;
  // bump to force client effects to re-run on repeated successes
  ts?: number;
}

export const initialFormState: FormState = {};

export function ok(): FormState {
  return { ok: true, ts: Date.now() };
}

export function fail(error: string): FormState {
  return { ok: false, error, ts: Date.now() };
}
