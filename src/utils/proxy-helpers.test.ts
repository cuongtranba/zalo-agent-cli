import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createProxyFetch, maskProxy } from "./proxy-helpers.ts";

describe("maskProxy", () => {
    it("masks password in http URL", () => {
        assert.equal(maskProxy("http://user:secret@host:8080"), "http://user:***@host:8080");
    });

    it("masks password in socks5 URL", () => {
        assert.equal(maskProxy("socks5://admin:p4ss@1.2.3.4:1080"), "socks5://admin:***@1.2.3.4:1080");
    });

    it("masks long password", () => {
        assert.equal(
            maskProxy("http://3AccFfq:pkLbHLRjhqids_session-Ntekoom2@geo.iproyal.com:12321"),
            "http://3AccFfq:***@geo.iproyal.com:12321",
        );
    });

    it("returns URL unchanged when no password", () => {
        assert.equal(maskProxy("http://host:8080"), "http://host:8080");
    });

    it('returns "none" for null', () => {
        assert.equal(maskProxy(null), "none");
    });

    it('returns "none" for empty string', () => {
        assert.equal(maskProxy(""), "none");
    });

    it('returns "none" for undefined', () => {
        assert.equal(maskProxy(undefined), "none");
    });
});

/** Start an HTTP server on an ephemeral loopback port. */
async function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { server, port: (server.address() as AddressInfo).port };
}

describe("createProxyFetch", () => {
    it("sends the request through the proxy instead of connecting to the target directly (regression: undici dispatcher is ignored by Bun)", async () => {
        const target = await listen((_req, res) => res.end("from-target"));
        // A forwarding proxy: records the absolute-form request line, then relays it to the real target
        const proxiedRequests: string[] = [];
        const proxy = await listen((req, res) => {
            proxiedRequests.push(`${req.method} ${req.url}`);
            const url = new URL(req.url ?? "");
            const upstream = http.request(
                { host: url.hostname, port: url.port, path: url.pathname, method: req.method },
                (upstreamRes) => upstreamRes.pipe(res),
            );
            upstream.end();
        });
        try {
            const proxiedFetch = createProxyFetch(`http://127.0.0.1:${proxy.port}`);
            const response = await proxiedFetch(`http://127.0.0.1:${target.port}/hello`);

            assert.equal(await response.text(), "from-target");
            assert.deepEqual(proxiedRequests, [`GET http://127.0.0.1:${target.port}/hello`]);
        } finally {
            proxy.server.close();
            target.server.close();
        }
    });
});
