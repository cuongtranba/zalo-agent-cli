/**
 * CLI interface tests — verify command parsing, help output, and basic behavior
 * without requiring a Zalo session.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import { resolve, join } from "path";

const CLI = resolve(import.meta.dirname, "index.ts");

function run(...args: string[]) {
    return execFileSync(process.execPath, [CLI, ...args], {
        encoding: "utf-8",
        timeout: 10000,
        env: { ...process.env, HOME: "/tmp/zalo-agent-cli-test-home" },
    });
}

describe("CLI interface", () => {
    it("--version outputs 1.0.0", () => {
        const out = run("--version");
        assert.match(out.trim(), /^\d+\.\d+\.\d+$/);
    });

    it("--help lists all command groups", () => {
        const out = run("--help");
        assert.match(out, /login/);
        assert.match(out, /msg/);
        assert.match(out, /friend/);
        assert.match(out, /group/);
        assert.match(out, /conv/);
        assert.match(out, /account/);
    });

    it("msg --help lists all subcommands", () => {
        const out = run("msg", "--help");
        assert.match(out, /send /);
        assert.match(out, /send-image/);
        assert.match(out, /send-file/);
        assert.match(out, /send-card/);
        assert.match(out, /send-bank/);
        assert.match(out, /send-qr-transfer/);
        assert.match(out, /sticker/);
        assert.match(out, /react/);
        assert.match(out, /delete/);
        assert.match(out, /forward/);
    });

    it("friend --help lists subcommands", () => {
        const out = run("friend", "--help");
        assert.match(out, /list/);
        assert.match(out, /find/);
        assert.match(out, /info/);
        assert.match(out, /block/);
    });

    it("group --help lists subcommands", () => {
        const out = run("group", "--help");
        assert.match(out, /create/);
        assert.match(out, /members/);
        assert.match(out, /rename/);
    });

    it("conv --help lists subcommands", () => {
        const out = run("conv", "--help");
        assert.match(out, /mute/);
        assert.match(out, /pinned/);
        assert.match(out, /archived/);
    });

    it("account --help lists subcommands", () => {
        const out = run("account", "--help");
        assert.match(out, /login/);
        assert.match(out, /switch/);
        assert.match(out, /export/);
        assert.match(out, /remove/);
    });

    it("login --help shows all flags", () => {
        const out = run("login", "--help");
        assert.match(out, /--proxy/);
        assert.match(out, /--credentials/);
        assert.match(out, /--qr-url/);
        assert.match(out, /--qr-port/);
    });

    it("logout --help shows --purge", () => {
        const out = run("logout", "--help");
        assert.match(out, /--purge/);
    });

    it("account list on clean state shows no accounts", () => {
        const out = run("account", "list");
        assert.match(out, /No accounts/);
    });

    it("mcp start exits 78 and asks to log in when there is no Zalo session (regression: pm2 crash loop)", () => {
        const home = fs.mkdtempSync(join(os.tmpdir(), "zalo-agent-cli-mcp-"));
        try {
            const result = spawnSync(process.execPath, [CLI, "mcp", "start"], {
                encoding: "utf-8",
                timeout: 15000,
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, HOME: home },
            });
            assert.equal(result.status, 78);
            assert.match(result.stderr, /zalo-agent login/);
            assert.equal(result.stdout, "");
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
