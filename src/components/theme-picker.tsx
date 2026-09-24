"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Moon, Palette, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENTS = [
  { key: "1", name: "Pitch", color: "#2fbf71" },
  { key: "2", name: "Arctic", color: "#3b82f6" },
  { key: "3", name: "Nova", color: "#a78bfa" },
  { key: "4", name: "Ember", color: "#fbbf24" },
  { key: "5", name: "Ruby", color: "#fb7185" },
] as const;

// The theme lives on <html> (class="dark", data-accent) and is written before
// paint by the inline script in layout.tsx. Reading it through an external
// store keeps the server render (dark + Pitch defaults) and the client in sync
// without a mount effect.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-accent"] });
  return () => observer.disconnect();
}

export function ThemePicker() {
  const isDark = useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => true);
  const accent = useSyncExternalStore(subscribe, () => document.documentElement.getAttribute("data-accent") || "1", () => "1");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [pickerOpen]);

  function toggleTheme() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("godevlab.theme", next ? "dark" : "light");
    } catch {}
  }

  function chooseAccent(key: string) {
    document.documentElement.setAttribute("data-accent", key);
    try {
      localStorage.setItem("godevlab.accent", key);
    } catch {}
  }

  return (
    <div className="relative flex items-center gap-1.5" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        aria-label="Choose accent color"
        aria-expanded={pickerOpen}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-foreground/5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Palette className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-foreground/5 text-muted-foreground transition-colors hover:text-foreground"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {pickerOpen && (
        <div className="glass-panel absolute bottom-10 left-0 z-10 w-40 space-y-1 p-2">
          <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Accent
          </p>
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => chooseAccent(a.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
                accent === a.key && "bg-foreground/10 text-foreground"
              )}
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: a.color }} />
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
