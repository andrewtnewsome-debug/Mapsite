import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { buildNotifications } from "@/lib/server/notifications";
import { loadWorkspace } from "@/lib/server/workspace";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspace = await loadWorkspace();
  const notifications = buildNotifications(workspace);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-60">
        <Topbar workspace={workspace} notifications={notifications} />
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
