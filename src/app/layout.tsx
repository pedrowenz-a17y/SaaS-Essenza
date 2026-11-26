import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@/lib/branding";
import "@fontsource-variable/manrope";
import "@fontsource-variable/playfair-display";
import "./globals.css";
import { RegisterWorker } from "@/components/pwa";

export const metadata: Metadata = {
  title: { default: APP_NAME + " · Gestão de beleza", template: "%s · " + APP_NAME },
  description: "Agenda, clientes, estoque e financeiro para profissionais de beleza e estética.",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#f8f4f2", width: "device-width", initialScale: 1 };

const themeScript = "try{const t=localStorage.getItem('essenza-theme');document.documentElement.dataset.theme=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch{}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>{children}<RegisterWorker /></body>
  </html>;
}
