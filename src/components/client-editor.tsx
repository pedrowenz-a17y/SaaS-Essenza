"use client";

import { Plus, Pencil } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/models";
import { phoneDisplay } from "@/lib/format";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { ActionForm, Sheet } from "./ui/form";
import { Button, Check, Field, Input, Textarea } from "./ui/primitives";

export function ClientEditor({ slug, client, initiallyOpen }: { slug: string; client?: Client; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen ?? false);
  return <Sheet title={client ? "Editar cliente" : "Cadastrar cliente"} open={open} onOpenChange={setOpen}
    trigger={<Button variant={client ? "secondary" : "primary"}>{client ? <Pencil size={16} /> : <Plus size={18} />}{client ? "Editar cliente" : "Nova cliente"}</Button>}>
    {close => <ActionForm action={workspaceAction.bind(null, slug, "client.save")} onSaved={close}>
      {client && <input type="hidden" name="id" value={client.id} />}
      <Field label="Nome completo"><Input name="name" defaultValue={client?.name} minLength={2} maxLength={150} required autoComplete="off" /></Field>
      <div className="form-grid">
        <Field label="Telefone"><Input name="phone" type="tel" placeholder="(11) 99999-0000" defaultValue={client ? phoneDisplay(client.phone) : ""} required maxLength={24} /></Field>
        <Field label="WhatsApp"><Input name="whatsapp" type="tel" defaultValue={client?.whatsapp ? phoneDisplay(client.whatsapp) : ""} maxLength={24} /></Field>
        <Field label="E-mail"><Input name="email" type="email" defaultValue={client?.email ?? ""} maxLength={254} /></Field>
        <Field label="Data de nascimento"><Input name="birthday" type="date" min="1900-01-01" defaultValue={client?.birthday ?? ""} /></Field>
      </div>
      <Field label="Preferências"><Textarea name="preferences" defaultValue={client?.preferences} maxLength={2000} /></Field>
      <Field label="Observações"><Textarea name="notes" defaultValue={client?.notes} maxLength={2000} /></Field>
      <fieldset><legend className="group-label">Consentimento para mensagens</legend>
        <div className="grid gap-2">
          <Check name="email_opt_in" defaultChecked={!!client?.email_consented_at}>Autorizou mensagens por e-mail</Check>
          <Check name="whatsapp_opt_in" defaultChecked={!!client?.whatsapp_consented_at}>Autorizou mensagens por WhatsApp</Check>
        </div>
      </fieldset>
    </ActionForm>}
  </Sheet>;
}

export function EraseClient({ slug, client }: { slug: string; client: Client }) {
  const router = useRouter();
  return <Sheet title="Excluir dados pessoais" description={"Esta operação é permanente. Os atendimentos de " + client.name + " ficam anonimizados para preservar os registros da empresa."}
    trigger={<Button variant="danger" size="small">Excluir dados</Button>}>
    {close => <ActionForm action={workspaceAction.bind(null, slug, "client.erase")} label="Excluir definitivamente" variant="danger"
      onSaved={() => { close(); router.push("/painel/" + slug + "/clientes"); }}>
      <input type="hidden" name="id" value={client.id} />
    </ActionForm>}
  </Sheet>;
}
