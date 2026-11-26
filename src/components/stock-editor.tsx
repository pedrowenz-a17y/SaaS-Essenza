"use client";

import { ArrowDownUp, Pencil, Plus } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { MovementKind, Product } from "@/lib/models";
import { moneyInput, movements, paymentMethods, quantity } from "@/lib/format";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { ActionForm, Sheet } from "./ui/form";
import { Button, Check, Field, Input, Select, Textarea } from "./ui/primitives";

export function ProductEditor({ slug, product, initiallyOpen }: { slug: string; product?: Product; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen ?? false);
  return <Sheet title={product ? "Editar produto" : "Cadastrar produto"} open={open} onOpenChange={setOpen}
    trigger={<Button variant={product ? "secondary" : "primary"} size={product ? "small" : "normal"}>{product ? <Pencil size={15} /> : <Plus size={18} />}{product ? "Editar" : "Novo produto"}</Button>}>
    {close => <ActionForm action={workspaceAction.bind(null, slug, "product.save")} onSaved={close}>
      {product && <input type="hidden" name="id" value={product.id} />}
      <Field label="Nome do produto"><Input name="name" required minLength={2} maxLength={120} defaultValue={product?.name} /></Field>
      <div className="form-grid">
        <Field label="Categoria"><Input name="category" maxLength={80} defaultValue={product?.category} /></Field>
        <Field label="Marca"><Input name="brand" maxLength={100} defaultValue={product?.brand} /></Field>
        <Field label="Fornecedor"><Input name="supplier" maxLength={120} defaultValue={product?.supplier} /></Field>
        <Field label="Unidade de medida"><Input name="unit" placeholder="Ex.: ml, par, unidade" maxLength={24} defaultValue={product?.unit ?? "un."} required /></Field>
        {!product && <Field label="Saldo inicial"><Input name="initial_stock" inputMode="decimal" defaultValue="0" pattern="[0-9]+([,.][0-9]{1,3})?" /></Field>}
        <Field label="Quantidade mínima"><Input name="minimum" inputMode="decimal" defaultValue={String(product?.minimum ?? 0).replace(".", ",")}
          pattern="[0-9]+([,.][0-9]{1,3})?" required /></Field>
        <Field label="Custo por unidade (R$)"><Input name="cost_cents" inputMode="decimal" defaultValue={moneyInput(product?.cost_cents ?? 0)}
          pattern="[0-9]+([,.][0-9]{1,2})?" required /></Field>
        <Field label="Validade"><Input name="expires_on" type="date" defaultValue={product?.expires_on ?? ""} /></Field>
      </div>
      <Field label="Local de armazenamento"><Input name="location" maxLength={150} defaultValue={product?.location} /></Field>
      <Field label="Observações"><Textarea name="notes" maxLength={2000} defaultValue={product?.notes} /></Field>
      {product?.photo_url && <Image src={product.photo_url} alt="Foto atual" width={76} height={76} className="image-thumb" unoptimized />}
      <Field label="Foto do produto" help="PNG, JPEG ou WebP de até 2 MB."><Input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
      {product?.photo_path && <Check name="remove_image">Remover foto atual</Check>}
    </ActionForm>}
  </Sheet>;
}

export function MovementEditor({ slug, product, replenish }: { slug: string; product: Product; replenish?: boolean }) {
  return <Sheet title={replenish ? "Registrar entrada" : "Movimentar estoque"} description={product.name + " · saldo " + quantity(product.quantity) + " " + product.unit}
    trigger={<Button variant={replenish ? "primary" : "secondary"} size="small"><ArrowDownUp size={15} />{replenish ? "Registrar entrada" : "Movimentar"}</Button>}>
    {close => <MovementForm slug={slug} product={product} replenish={replenish} close={close} />}
  </Sheet>;
}

function MovementForm({ slug, product, replenish, close }: { slug: string; product: Product; replenish?: boolean; close: () => void }) {
  const [kind, setKind] = useState<MovementKind>("in");
  const suggested = Math.max(0.001, product.minimum - product.quantity + 1);
  return <ActionForm action={workspaceAction.bind(null, slug, "stock.move")} label="Registrar movimentação" onSaved={close}>
    <input type="hidden" name="id" value={product.id} />
    {replenish ? <input type="hidden" name="kind" value="in" /> : <Field label="Tipo de movimentação">
      <Select name="kind" value={kind} onChange={event => setKind(event.target.value as MovementKind)}>
        {Object.entries(movements).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </Select>
    </Field>}
    <Field label={(kind === "adjustment" ? "Novo saldo" : "Quantidade") + " (" + product.unit + ")"}
      help={kind === "adjustment" ? "Informe o saldo contado na conferência." : undefined}>
      <Input name="quantity" inputMode="decimal" defaultValue={replenish ? String(Math.round(suggested * 1000) / 1000).replace(".", ",") : undefined} required />
    </Field>
    {kind === "in" && <div className="form-grid">
      <Field label="Custo unitário (R$)" help="Em branco, mantém o custo atual."><Input inputMode="decimal" name="cost_cents" defaultValue={replenish ? moneyInput(product.cost_cents) : ""} /></Field>
      <Field label="Registrar como despesa paga"><Select name="method"><option value="">Só registrar estoque</option>
        {Object.entries(paymentMethods).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </Select></Field>
    </div>}
    <Field label="Observações"><Textarea name="notes" maxLength={2000} /></Field>
  </ActionForm>;
}
