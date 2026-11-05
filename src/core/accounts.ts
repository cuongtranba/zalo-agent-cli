/**
 * Multi-account registry at ~/.zalo-agent-cli/accounts.json
 * Maps each account to its own proxy (1:1) and tracks active account.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { CONFIG_DIR, deleteCredentials } from "./credentials.ts";

export interface Account {
    ownId: string;
    name: string;
    proxy: string | null;
    active: boolean;
}

const ACCOUNTS_FILE = `${CONFIG_DIR}/accounts.json`;

function ensureDir(): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
}

function load(): Account[] {
    if (!existsSync(ACCOUNTS_FILE)) return [];
    try {
        return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf-8"));
    } catch {
        return [];
    }
}

function save(accounts: Account[]): void {
    ensureDir();
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    chmodSync(ACCOUNTS_FILE, 0o600);
}

/** List all registered accounts. */
export function listAccounts(): Account[] {
    return load();
}

/** Get currently active account or null. */
export function getActive(): Account | null {
    return load().find((a) => a.active) || null;
}

/** Set an account as active (deactivates others). Returns false if not found. */
export function setActive(ownId: string): boolean {
    const accounts = load();
    let found = false;
    for (const a of accounts) {
        if (a.ownId === ownId) {
            a.active = true;
            found = true;
        } else {
            a.active = false;
        }
    }
    if (found) save(accounts);
    return found;
}

/** Register a new account or update existing. New account becomes active. */
export function addAccount(ownId: string, name = "", proxy: string | null = null): void {
    const accounts = load();
    const existing = accounts.find((a) => a.ownId === ownId);
    if (existing) {
        existing.name = name || existing.name || "";
        existing.proxy = proxy;
    } else {
        for (const a of accounts) a.active = false;
        accounts.push({ ownId, name, proxy, active: true });
    }
    save(accounts);
}

/** Remove account from registry and delete its credentials. */
export function removeAccount(ownId: string): boolean {
    const accounts = load();
    const filtered = accounts.filter((a) => a.ownId !== ownId);
    if (filtered.length === accounts.length) return false;
    // If removed was active, activate first remaining
    if (filtered.length && !filtered.some((a) => a.active)) {
        filtered[0].active = true;
    }
    save(filtered);
    deleteCredentials(ownId);
    return true;
}

/** Get account by ownId. */
export function getAccount(ownId: string): Account | null {
    return load().find((a) => a.ownId === ownId) || null;
}

/** Get proxy URL for a specific account. */
export function getProxyFor(ownId: string): string | null {
    const acc = getAccount(ownId);
    return acc?.proxy || null;
}
