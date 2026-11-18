/**
 * DNS-rebinding protection for a localhost-only app: requests must address
 * the server by a loopback host name. A malicious website that rebinds its
 * domain to 127.0.0.1 still sends its own domain in the Host header and is
 * rejected. Extra hosts can be allowed with FINANCEOS_ALLOWED_HOSTS.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : null;
  }
  return h.split(":")[0] || null;
}

export function isAllowedHost(hostHeader: string | null, extra: string | undefined = undefined): boolean {
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  const allowed = (extra ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(host);
}
