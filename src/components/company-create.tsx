"use client";

import { useState } from "react";
import { createCompany } from "@/lib/server/auth-actions";
import { slugify } from "@/lib/format";
import { ActionForm } from "./ui/form";
import { Field, Input } from "./ui/primitives";

export function CompanyCreate({ userName }: { userName: string }) {
  const [address, setAddress] = useState("");
  const [manual, setManual] = useState(false);
  return <ActionForm action={createCompany} label="Criar empresa">
    <Field label="Nome da empresa"><Input name="name" required minLength={2} maxLength={100} onChange={event => {
      if (!manual) setAddress(slugify(event.target.value));
    }} /></Field>
    <Field label="Endereço do agendamento" help={"/agendar/" + (address || "sua-empresa")}>
      <Input name="slug" value={address} required minLength={3} maxLength={48} pattern="[a-z0-9][a-z0-9\-]{2,47}" onChange={event => {
        setManual(true);
        setAddress(event.target.value);
      }} />
    </Field>
    <Field label="Seu nome na equipe"><Input name="member" defaultValue={userName} required minLength={2} maxLength={100} /></Field>
  </ActionForm>;
}
