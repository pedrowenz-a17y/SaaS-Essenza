export type ActionState = { ok?: boolean; error?: string; message?: string; path?: string };
export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;
