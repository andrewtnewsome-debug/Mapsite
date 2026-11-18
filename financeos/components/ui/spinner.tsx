import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <LoaderCircle aria-hidden className={cn("size-4 animate-spin text-text-3", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
