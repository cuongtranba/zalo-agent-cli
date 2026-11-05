/**
 * Proxy URL helpers — masking passwords for safe display.
 */

/**
 * Mask password in proxy URL for safe display.
 * Example: http://user:secret@host:8080 → http://user:***@host:8080
 */
export function maskProxy(proxyUrl: string | null | undefined): string {
    if (!proxyUrl) return "none";
    return proxyUrl.replace(/(\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

/**
 * Create a fetch that routes every request through the given proxy.
 * Bun's fetch takes a `proxy` option; the `dispatcher` option used by undici is ignored.
 */
export function createProxyFetch(proxyUrl: string): typeof fetch {
    const proxied = (input: string | URL | Request, init: RequestInit = {}) =>
        fetch(input, { ...init, proxy: proxyUrl });
    return Object.assign(proxied, { preconnect: fetch.preconnect });
}
