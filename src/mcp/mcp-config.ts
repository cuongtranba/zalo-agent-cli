/**
 * Load/save MCP-specific config from ~/.zalo-agent-cli/mcp-config.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { CONFIG_DIR } from "../core/credentials.ts";

const MCP_CONFIG_FILE = join(CONFIG_DIR, "mcp-config.json");

/** MCP server configuration persisted in mcp-config.json. */
export interface MCPConfig {
    watchThreads: string[];
    mode: string;
    triggerKeywords: string[];
    notify: {
        enabled: boolean;
        thread: string | null;
        on: string[];
        cooldown: string | number;
    };
    limits: {
        maxMessagesPerPoll: number;
        autoDigestThreshold: number;
        bufferMaxAge: string | number;
        bufferMaxSize: number;
        sessionIdleTimeout: string | number;
    };
    media: {
        downloadDir: string | null;
        autoOpen: boolean;
    };
}

/** The slice of MCPConfig the tools, resources and HTTP transport read; every part may be absent. */
export interface MCPServerConfig {
    limits?: Partial<MCPConfig["limits"]>;
    media?: Partial<MCPConfig["media"]>;
}

/** Default MCP config — sensible defaults for local development */
export function getDefaultConfig(): MCPConfig {
    return {
        watchThreads: ["dm:*", "group:*"],
        mode: "manual",
        triggerKeywords: ["@bot"],
        notify: {
            enabled: false,
            thread: null,
            on: ["dm"],
            cooldown: "5m",
        },
        limits: {
            maxMessagesPerPoll: 20,
            autoDigestThreshold: 50,
            bufferMaxAge: "2h",
            bufferMaxSize: 500,
            sessionIdleTimeout: "30m",
        },
        media: {
            downloadDir: null, // default: ~/.zalo-agent-cli/media/
            autoOpen: true,
        },
    };
}

/**
 * Load MCP config from disk, merged with defaults.
 */
export function loadMCPConfig(): MCPConfig {
    const defaults = getDefaultConfig();
    try {
        const raw = readFileSync(MCP_CONFIG_FILE, "utf-8");
        const saved = JSON.parse(raw);
        // Shallow merge: saved values override defaults
        return {
            ...defaults,
            ...saved,
            notify: { ...defaults.notify, ...saved.notify },
            limits: { ...defaults.limits, ...saved.limits },
            media: { ...defaults.media, ...saved.media },
        };
    } catch {
        // File doesn't exist or invalid JSON — use defaults
        return defaults;
    }
}

/**
 * Save MCP config to disk.
 * @param {object} config
 */
export function saveMCPConfig(config: MCPConfig): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Parse duration string (e.g. "2h", "5m", "30s") to milliseconds.
 * @param {string|number} duration
 * @returns {number} Milliseconds
 */
export function parseDuration(duration: string | number): number {
    if (typeof duration === "number") return duration;
    const match = String(duration).match(/^(\d+)\s*(h|m|s|ms)?$/i);
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    const unit = (match[2] || "ms").toLowerCase();
    const multipliers: Record<string, number> = { h: 3600000, m: 60000, s: 1000, ms: 1 };
    return value * (multipliers[unit] || 1);
}
