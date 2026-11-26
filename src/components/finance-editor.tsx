"use client";

import { CircleDollarSign, Pencil, Plus } from "lucide-react";
import type { FinanceEntry } from "@/lib/models";
import { local, money, moneyInput, paymentMethods } from "@/lib/format";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { ActionForm, Sheet } from "./ui/form";
import { Button, Field, Input, Select } from "./ui/primitives";

function PaymentFields({ entry, defaultToToday }: { entry?: FinanceEntry; defaultToToday?: boolean }) {
  const today = local().toISODate()!;
  return <div className="form-grid">
    <Field label="Data do pagamento" help="Em branco se estiver pendente."><Input type="date" name="settled_on" max={today}
      defaultValue={entry?.settled_on ?? (defaultToToday ? today : "")} /></Field>
    <Field label="Forma de pagamento"><Select name="method" defaultValue={entry?.method ?? ""}><option value="">Selecione</option>
      {Object.entries(paymentMethods).map(([key,value]) => <option key={key} value={key}>{value}</option>)}
    </Select></Field>
  </div>;
}

export function FinanceEditor({ slug, entry }: { slug: string; entry?: FinanceEntry }) {
  return <Sheet title={entry ? "Editar lançamento" : "Novo lançamento"} trigger={<Button variant={entry ? "secondary" : "primary"}
    size={entry ? "small" : "normal"}>{entry ? <Pencil size={15} /> : <Plus size={18} />}{entry ? "Editar" : "Novo lançamento"}</Button>}>
    {close => <ActionForm action={workspaceAction.bind(null, slug, "finance.save")} onSaved={close}>
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <div className="form-grid">
        <Field label="Tipo"><Select name="kind" defaultValue={entry?.kind ?? "income"}><option value="income">Receita</option><option value="expense">Despesa</option></Select></Field>
        <Field label="Data do lançamento"><Input type="date" name="occurred_on" defaultValue={entry?.occurred_on ?? local().toISODate()!} required /></Field>
      </div>
      <Field label="Descrição"><Input name="description" maxLength={180} minLength={2} defaultValue={entry?.description} required /></Field>
      <div className="form-grid">
        <Field label="Categoria"><Input name="category" maxLength={100} placeholder="Ex.: Produtos" defaultValue={entry?.category} /></Field>
        <Field label="Valor (R$)"><Input name="amount_cents" required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" defaultValue={entry ? moneyInput(entry.amount_cents) : ""} /></Field>
      </div>
      <PaymentFields entry={entry} />
    </ActionForm>}
  </Sheet>;
}

export function SettlementEditor({ slug, entry }: { slug: string; entry: FinanceEntry }) {
  return <Sheet title="Pagamento" description={entry.description + " · " + money(entry.amount_cents)}
    trigger={<Button variant="secondary" size="small"><CircleDollarSign size={15} />{entry.settled_on ? "Alterar pagamento" : "Registrar pagamento"}</Button>}>
    {close => <ActionForm action={workspaceAction.bind(null, slug, "finance.settle")} onSaved={close}>
      <input type="hidden" name="id" value={entry.id} /><PaymentFields entry={entry} defaultToToday />
    </ActionForm>}
  </Sheet>;
}
