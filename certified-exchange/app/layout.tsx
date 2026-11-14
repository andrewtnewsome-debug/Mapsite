import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const style = { "--brand": brand.colors.accent, "--brand-hover": brand.colors.accentHover } as React.CSSProperties;
  return (
    <html lang="en" style={style}>
      <body className="min-h-screen font-sans">
        <StoreProvider>
          <ToastProvider>{children}</ToastProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
