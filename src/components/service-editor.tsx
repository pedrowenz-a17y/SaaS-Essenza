"use client";

import { Plus, Pencil, X } from "lucide-react";
import { useState } from "react";
import type { Member, Product, Service } from "@/lib/models";
import { money, moneyInput } from "@/lib/format";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { ActionForm, Sheet } from "./ui/form";
import { Button, Check, Field, Input, Select, Textarea } from "./ui/primitives";

export function ServiceEditor({ slug, service, products, members, initiallyOpen }: {
  slug: string; service?: Service; products: Product[]; members: Member[]; initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen ?? false);
  return <Sheet title={service ? "Editar serviço" : "Cadastrar serviço"} open={open} onOpenChange={setOpen}
    trigger={<Button variant={service ? "secondary" : "primary"} size={service ? "small" : "normal"}>{service ? <Pencil size={15} /> : <Plus size={18} />}{service ? "Editar" : "Novo serviço"}</Button>}>
    {close => <ServiceForm slug={slug} service={service} products={products} members={members} close={close} />}
  </Sheet>;
}

function ServiceForm({ slug, service, products, members, close }: { slug: string; service?: Service; products: Product[]; members: Member[]; close: () => void }) {
  const [materials, setMaterials] = useState(() => (service?.service_materials ?? []).map(item => ({
    key: item.product_id, productId: item.product_id, amount: String(item.quantity).replace(".", ","),
  })));
  const [price, setPrice] = useState(service ? moneyInput(service.price_cents) : "");
  const cost = Math.round(materials.reduce((total, item) => total +
    (products.find(product => product.id === item.productId)?.cost_cents ?? 0) * (Number(item.amount.replace(",", ".")) || 0), 0));
  const professionals = members.filter(member => member.active && member.bookable);

  return <ActionForm action={workspaceAction.bind(null, slug, "service.save")} onSaved={close}>
    {service && <input type="hidden" name="id" value={service.id} />}
    <Field label="Nome do serviço"><Input name="name" required minLength={2} maxLength={120} defaultValue={service?.name} /></Field>
    <Field label="Categoria"><Input name="category" placeholder="Ex.: Cílios" maxLength={80} defaultValue={service?.category} /></Field>
    <div className="form-grid">
      <Field label="Preço (R$)"><Input name="price_cents" inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" required value={price} onChange={event => setPrice(event.target.value)} /></Field>
      <Field label="Duração em minutos"><Input name="duration_minutes" type="number" min={5} max={720} required defaultValue={service?.duration_minutes ?? 60} /></Field>
    </div>
    <Field label="Cor na agenda"><Input name="color" type="color" defaultValue={service?.color ?? "#A75E78"} /></Field>
    <Field label="Descrição"><Textarea name="description" maxLength={1200} defaultValue={service?.description} /></Field>
    <fieldset><legend className="group-label">Profissionais responsáveis</legend>
      {professionals.length ? <div className="grid gap-2">{professionals.map(member => <Check key={member.id} name="professionals" value={member.id}
        defaultChecked={service?.service_professionals.some(item => item.member_id === member.id)}>{member.name}</Check>)}</div>
        : <p className="subtle">Habilite profissionais para a agenda nas configurações da equipe.</p>}
    </fieldset>
    <fieldset><legend className="group-label">Materiais por atendimento</legend>
      {materials.map(row => <div className="material-row" key={row.key}>
        <Field label="Produto"><Select name="product_id" required value={row.productId} onChange={event => setMaterials(current => current.map(item => item.key === row.key ? { ...item, productId: event.target.value } : item))}>
          <option value="">Selecione</option>{products.filter(product => product.active || product.id === row.productId).map(product =>
            <option key={product.id} value={product.id}>{product.name} ({product.unit})</option>)}
        </Select></Field>
        <Field label="Quantidade"><Input name="material_quantity" required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,3})?"
          value={row.amount} onChange={event => setMaterials(current => current.map(item => item.key === row.key ? { ...item, amount: event.target.value } : item))} /></Field>
        <Button variant="ghost" size="icon" aria-label="Remover material" onClick={() => setMaterials(current => current.filter(item => item.key !== row.key))}><X size={17} /></Button>
      </div>)}
      {products.some(product => product.active) ? <Button variant="secondary" size="small" disabled={materials.length >= 50}
        onClick={() => setMaterials(current => [...current, { key: crypto.randomUUID(), productId: "", amount: "1" }])}><Plus size={16} />Adicionar material</Button>
        : <p className="subtle">Cadastre produtos no estoque para vinculá-los ao serviço.</p>}
    </fieldset>
    <dl className="summary-lines">
      <div><dt>Custo estimado dos materiais</dt><dd>{money(cost)}</dd></div>
      <div><dt>Margem após materiais</dt><dd>{money(Math.round((Number(price.replace(",", ".")) || 0) * 100) - cost)}</dd></div>
    </dl>
  </ActionForm>;
}
