"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "./ui/primitives";

function subscribe(callback: () => void) {
  window.addEventListener("essenza-theme", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("essenza-theme", callback);
    window.removeEventListener("storage", callback);
  };
}
function darkMode() { return document.documentElement.dataset.theme === "dark"; }

export function ThemeButton() {
  const dark = useSyncExternalStore(subscribe, darkMode, () => false);
  function toggle() {
    const theme = dark ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("essenza-theme", theme);
    window.dispatchEvent(new Event("essenza-theme"));
  }
  return <Button variant="ghost" size="icon" aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"} onClick={toggle}>
    {dark ? <Sun size={19} /> : <Moon size={19} />}
  </Button>;
}
