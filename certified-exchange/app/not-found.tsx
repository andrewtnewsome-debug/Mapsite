import Link from "next/link";
import { brand } from "@/config/brand";
import { Logo } from "@/components/shell/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
      <Logo />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="max-w-md text-[14px] text-slate-500">
        The page you were looking for does not exist on {brand.name}. It may have been moved, or the listing may no longer be available.
      </p>
      <div className="flex gap-2">
        <Link href="/deals" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          Go to the deal feed
        </Link>
        <Link href="/" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Home
        </Link>
      </div>
    </div>
  );
}
