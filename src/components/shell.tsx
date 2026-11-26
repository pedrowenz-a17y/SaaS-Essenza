"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/branding";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell, CalendarDays, ChevronDown, CircleDollarSign, LayoutGrid, LogOut, Menu, Package,
  PanelLeftClose, PanelLeftOpen, Scissors, Settings, UsersRound, X,
} from "lucide-react";
import { initial, roles } from "@/lib/format";
import type { Role } from "@/lib/models";
import { signOut } from "@/lib/server/auth-actions";
import { Brand, Button } from "./ui/primitives";
import { ThemeButton } from "./theme";

const links = [
  { path: "", name: "Visão geral", icon: LayoutGrid },
  { path: "/agenda", name: "Agenda", icon: CalendarDays },
  { path: "/clientes", name: "Clientes", icon: UsersRound },
  { path: "/servicos", name: "Serviços", icon: Scissors },
  { path: "/estoque", name: "Estoque", icon: Package, manager: true },
  { path: "/financeiro", name: "Financeiro", icon: CircleDollarSign, manager: true },
  { path: "/notificacoes", name: "Notificações", icon: Bell },
  { path: "/configuracoes", name: "Configurações", icon: Settings, manager: true },
];

export function AppShell({ base, company, logo, role, user, count, date, children }: {
  base: string; company: string; logo: string | null; role: Role; user: string; count: number; date: string; children: ReactNode;
}) {
  const [compact, setCompact] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const active = links.findLast(link => link.path && (pathname === base + link.path || pathname.startsWith(base + link.path + "/"))) ?? links[0];
  const menu = links.filter(link => !link.manager || role === "owner" || role === "admin");

  useEffect(() => {
    if (!drawer) return;
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => { if (event.matches) setDrawer(false); };
    desktop.addEventListener("change", closeOnDesktop);
    close.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(false);
        requestAnimationFrame(() => toggle.current?.focus());
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => { window.removeEventListener("keydown", dismiss); desktop.removeEventListener("change", closeOnDesktop); };
  }, [drawer]);

  function navLink(link: typeof links[number]) {
    const Icon = link.icon;
    return <Link key={link.path} className="nav-link" href={base + link.path} onClick={() => setDrawer(false)}
      aria-current={active.path === link.path ? "page" : undefined} aria-label={link.name} title={link.name}>
      <Icon size={18} strokeWidth={1.85} /><span className="nav-text">{link.name}</span>
    </Link>;
  }

  return <div className="shell" data-compact={compact} data-drawer={drawer}>
    <a className="skip-nav" href="#conteudo">Ir para o conteúdo</a>
    {drawer && <button className="drawer-shade" type="button" aria-label="Fechar menu" onClick={() => setDrawer(false)} tabIndex={-1} />}
    <aside className="sidebar" aria-label="Menu de navegação">
      <div className="sidebar-top"><Link href={base} onClick={() => setDrawer(false)} aria-label={"Página inicial " + APP_NAME}><Brand subtitle="Gestão de beleza" /></Link>
        <Button variant="ghost" className="mobile-menu" size="icon" ref={close} aria-label="Fechar menu" onClick={() => {
          setDrawer(false);
          requestAnimationFrame(() => toggle.current?.focus());
        }}><X size={19} /></Button>
      </div>
      <Link href="/inicio" className="workspace-switch" aria-label="Trocar empresa" title={company} onClick={() => setDrawer(false)}>
        {logo ? <span className="workspace-logo"><Brand compact logo={logo} /></span> : <span className="avatar">{initial(company)}</span>}
        <span className="nav-text"><strong>{company}</strong><small>Minha empresa</small></span><ChevronDown size={15} />
      </Link>
      <nav aria-label="Páginas do painel">
        <p className="nav-label">Gestão</p>
        <div className="nav-list">{menu.filter(link => !["/notificacoes", "/configuracoes"].includes(link.path)).map(navLink)}</div>
        <div className="nav-list nav-secondary">{menu.filter(link => ["/notificacoes", "/configuracoes"].includes(link.path)).map(navLink)}</div>
      </nav>
      <div className="side-foot">
        <div className="account">
          <span className="avatar avatar-lilac">{initial(user)}</span>
          <span className="account-text"><strong>{user}</strong><small>{roles[role]}</small></span>
          <form action={signOut}><Button variant="ghost" size="icon" type="submit" aria-label="Sair da conta" title="Sair da conta"><LogOut size={17} /></Button></form>
        </div>
      </div>
    </aside>
    <div className="shell-main" inert={drawer}>
      <header className="topbar">
        <div className="topbar-part">
          <Button ref={toggle} className="mobile-menu" variant="ghost" size="icon" aria-label="Abrir menu" aria-expanded={drawer} onClick={() => setDrawer(true)}><Menu size={21} /></Button>
          <Button className="desktop-collapse" variant="ghost" size="icon" aria-label={compact ? "Expandir menu" : "Recolher menu"} onClick={() => setCompact(!compact)}>
            {compact ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </Button>
          <span className="topbar-crumb">{active.name}</span>
        </div>
        <div className="topbar-part">
          <span className="topbar-date"><CalendarDays size={16} />{date}</span>
          <ThemeButton />
          <Button asChild className="icon-link" variant="ghost" size="icon"><Link href={base + "/notificacoes"} aria-label={count ? count + " notificações não lidas" : "Notificações"}>
            <Bell size={19} />{count > 0 && <span className="unread">{count > 99 ? "99+" : count}</span>}</Link></Button>
        </div>
      </header>
      <main id="conteudo" className="page-content">{children}</main>
    </div>
  </div>;
}
