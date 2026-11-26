"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle, X } from "lucide-react";
import { startTransition, useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { ActionState, FormAction } from "@/lib/server/action-state";
import { Button, cn } from "./primitives";

export function ActionForm({ action, children, label = "Salvar", className, footer, onSaved, variant, disabled, compact = false, confirm }: {
  action: FormAction; children?: ReactNode; label?: string; className?: string; footer?: ReactNode;
  onSaved?: (state: ActionState) => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean;
  compact?: boolean; confirm?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.ok && onSaved) onSaved(state);
  }, [state, onSaved]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return <form onSubmit={submit} className={cn(compact ? "inline-form" : "form-stack", className)}>
    {children}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.message && !onSaved && <p className="form-success" role="status">{state.message}</p>}
    <div className={compact ? "inline-form-button" : "form-footer"}>
      {footer}
      <Button type="submit" size={compact ? "small" : "normal"} variant={variant} disabled={disabled || pending}>
        {pending && <LoaderCircle size={16} className="spin" />}{pending ? "Salvando…" : label}
      </Button>
    </div>
  </form>;
}

export function Sheet({ title, description, trigger, children, open: controlled, onOpenChange }: {
  title: string; description?: string; trigger?: ReactNode;
  children: (close: () => void) => ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [local, setLocal] = useState(false);
  const open = controlled ?? local;
  const setOpen = onOpenChange ?? setLocal;
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay" />
      <Dialog.Content className="sheet" {...(!description ? { "aria-describedby": undefined } : {})}>
        <header className="sheet-header">
          <div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description>{description}</Dialog.Description>}</div>
          <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Fechar"><X size={20} /></Button></Dialog.Close>
        </header>
        <div className="sheet-body">{open && children(() => setOpen(false))}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
