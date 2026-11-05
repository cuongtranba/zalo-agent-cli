/**
 * Proxy URL helpers — masking passwords for safe display.
 */

/**
 * Mask password in proxy URL for safe display.
 * Example: http://user:secret@host:8080 → http://user:***@host:8080
 * @param {string|null} proxyUrl
 * @returns {string}
 */
export function maskProxy(proxyUrl) {
    if (!proxyUrl) return "none";
    return proxyUrl.replace(/(\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

/**
 * Create a fetch that routes every request through the given proxy.
 * Bun's fetch takes a `proxy` option; the `dispatcher` option used by undici is ignored.
 * @param {string} proxyUrl
 * @returns {(url: string | URL | Request, init?: RequestInit) => Promise<Response>}
 */
export function createProxyFetch(proxyUrl) {
    return (url, init = {}) => fetch(url, { ...init, proxy: proxyUrl });
}
