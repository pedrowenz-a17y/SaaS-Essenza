import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME + " · Gestão de beleza", short_name: APP_NAME, lang: "pt-BR",
    description: "Agenda e gestão para profissionais de beleza e estética.",
    start_url: "/", scope: "/", display: "standalone", background_color: "#f8f4f2", theme_color: "#f8f4f2",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
