import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost } from "@/lib/host-guard";

export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"), process.env.FINANCEOS_ALLOWED_HOSTS)) {
    return new NextResponse("FinanceOS only accepts requests addressed to localhost.", { status: 421, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
