import { describe, expect, it } from "vitest";
import { csv, csvCell } from "@/lib/csv";
import { local, slugify, hour } from "@/lib/format";
import { businessHours, cents, clientSchema, localizedNumber, materialSchema, phone, validReturnTo } from "@/lib/validation";
import { signBookingToken, verifyBookingToken } from "@/lib/server/booking-token";

const appointment = "ebc80d18-4034-4ffa-8b77-fc333beb4ffe";
const secret = "segredo-exclusivo-usado-para-esses-testes";
const expiry = 1850184000;

describe("horário de Brasília", () => {
  it("converte de UTC e armazena instantes com fuso", () => {
    expect(hour("2028-08-10T17:00:00Z")).toBe("14:00");
    expect(local("2028-08-10T14:00").toUTC().toISO()).toBe("2028-08-10T17:00:00.000Z");
    expect(local("2028-08-13T02:00:00+00:00").toISODate()).toBe("2028-08-12");
  });
  it("valida a jornada de trabalho", () => {
    expect(businessHours.safeParse({ open: "09:00", close: "17:00" }).success).toBe(true);
    expect(businessHours.safeParse({ open: "18:00", close: "09:00" }).success).toBe(false);
  });
});

describe("dados do cadastro", () => {
  it("normaliza contatos e endereços", () => {
    expect(phone.parse("(11) 99999-0001")).toBe("+5511999990001");
    expect(phone.parse("+351 912 345 678")).toBe("+351912345678");
    expect(phone.safeParse("3333-0000").success).toBe(false);
    expect(slugify(" Espaço Éssenza & Beleza ")).toBe("espaco-essenza-beleza");
  });
  it("exige um contato por canal quando há consentimento", () => {
    const input = { name: "Ana Teste", phone: "(11) 99999-0001", email: "", whatsapp: "", birthday: "",
      notes: "", preferences: "", email_opt_in: true, whatsapp_opt_in: false };
    expect(clientSchema.safeParse(input).success).toBe(false);
    expect(clientSchema.safeParse({ ...input, email: "ana@example.test" }).success).toBe(true);
    expect(clientSchema.safeParse({ ...input, email_opt_in: false }).success).toBe(true);
  });
  it("aceita dinheiro e quantidades fracionárias sem truncamento", () => {
    expect(cents.parse("159,90")).toBe(15990);
    expect(localizedNumber(3).parse("0,125")).toBe(0.125);
    expect(localizedNumber(3).safeParse("0,0125").success).toBe(false);
    expect(cents.safeParse("-4,00").success).toBe(false);
    expect(materialSchema.safeParse([{ product_id: appointment, quantity: "1" }, { product_id: appointment, quantity: "2" }]).success).toBe(false);
  });
});

describe("link de atendimento", () => {
  it("verifica a assinatura, a vigência e a versão da agenda", () => {
    const token = signBookingToken(appointment, 4, expiry, secret);
    expect(verifyBookingToken(token, secret, (expiry - 100) * 1000)).toEqual({ id: appointment, version: 4 });
    expect(verifyBookingToken(token, secret + "1", (expiry - 100) * 1000)).toBeNull();
    expect(verifyBookingToken(token, secret, (expiry + 1) * 1000)).toBeNull();
    expect(verifyBookingToken(token.replace(/^./, token[0] === "A" ? "B" : "A"), secret, 0)).toBeNull();
  });
  it("restringe redirecionamentos de autenticação", () => {
    expect(validReturnTo("//exemplo.com")).toBe("/inicio");
    expect(validReturnTo("/redefinir")).toBe("/redefinir");
    expect(validReturnTo("/redefinir\\@exemplo.com")).toBe("/inicio");
  });
});

describe("exportação CSV", () => {
  it("mantém acentos, aspas e campos delimitados em planilhas", () => {
    expect(csv([["Descrição", "Valor"], ['Compra de "cola"', 14]])).toBe('\uFEFF"Descrição";"Valor"\r\n"Compra de ""cola""";"14"\r\n');
  });
  it("trata fórmulas como texto", () => {
    expect(csvCell(" =1+1")).toBe("\"' =1+1\"");
    expect(csvCell("@A1")).toBe("\"'@A1\"");
    expect(csvCell(-5)).toBe('"-5"');
  });
});
