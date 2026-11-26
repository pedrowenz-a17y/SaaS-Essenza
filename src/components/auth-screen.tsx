import Link from "next/link";
import { connection } from "next/server";
import { APP_NAME } from "@/lib/branding";
import { authAction } from "@/lib/server/auth-actions";
import { supabaseConfig } from "@/lib/supabase/server";
import { ActionForm } from "./ui/form";
import { Brand, Field, Input } from "./ui/primitives";
import { ThemeButton } from "./theme";

const content = {
  login: { title: "Bem-vinda à " + APP_NAME, description: "Entre na sua conta para acessar o painel.", button: "Entrar" },
  signup: { title: "Crie sua conta", description: "Use o e-mail da empresa ou o mesmo e-mail do convite da sua equipe.", button: "Criar conta" },
  recover: { title: "Recupere sua senha", description: "Informe o e-mail da sua conta para receber um link de recuperação.", button: "Enviar link" },
  reset: { title: "Escolha uma nova senha", description: "Use pelo menos 8 caracteres.", button: "Salvar nova senha" },
};

export async function AuthScreen({ mode, invalidLink }: { mode: keyof typeof content; invalidLink?: boolean }) {
  await connection();
  const page = content[mode];
  const connected = !!supabaseConfig();
  return <main className="auth-page">
    <div className="auth-main">
      <header className="auth-top"><Link href="/" aria-label={APP_NAME}><Brand subtitle="Gestão de beleza" /></Link><ThemeButton /></header>
      <div className="auth-form-box">
        <h1>{page.title}</h1><p>{page.description}</p>
        {!connected && <p className="form-note" role="status">Configure as variáveis do Supabase para conectar o aplicativo ao banco de dados.</p>}
        {invalidLink && <p className="form-error" role="alert">Este link expirou ou já foi usado. Solicite um novo link.</p>}
        <ActionForm action={authAction.bind(null, mode)} label={page.button} disabled={!connected}>
          {mode === "signup" && <Field label="Seu nome"><Input name="name" autoComplete="name" required minLength={2} maxLength={100} /></Field>}
          {mode !== "reset" && <Field label="E-mail"><Input name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" required maxLength={254} /></Field>}
          {mode !== "recover" && <Field label={mode === "reset" ? "Nova senha" : "Senha"} help={mode === "signup" ? "No mínimo 8 caracteres." : undefined}>
            <Input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={72} required />
          </Field>}
          {mode === "reset" && <Field label="Confirme sua senha"><Input type="password" name="confirmation" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>}
        </ActionForm>
        <div className="auth-actions">
          {mode === "login" ? <><Link className="text-link" href="/recuperar">Esqueci minha senha</Link><span>Ainda não tem conta? <Link className="text-link" href="/cadastro">Cadastre-se</Link></span></>
            : <Link className="text-link" href="/login">Voltar para o login</Link>}
        </div>
      </div>
    </div>
    <div className="auth-art">
      <div className="auth-art-copy"><h2>Mais tempo para o seu trabalho.</h2><p>Organize agenda, clientes e estoque em um só lugar.</p></div>
    </div>
  </main>;
}
