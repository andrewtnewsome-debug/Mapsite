"use client";

import { CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "success" | "info";
}

const ToastContext = createContext<(t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { tone: "success", ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4800);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg"
            role="status"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              {t.body && <p className={cn("mt-0.5 text-[13px] text-slate-500")}>{t.body}</p>}
            </div>
            <button
              type="button"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
