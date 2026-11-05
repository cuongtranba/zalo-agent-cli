/**
 * Non-blocking update check — warns user if a newer version is available on npm.
 * Never throws; network problems are silent.
 */

import { spawn } from "node:child_process";
import { warning } from "./output.js";

const LATEST_URL = "https://registry.npmjs.org/zalo-agent-cli/latest";

/**
 * Check npm registry for latest version, warn if outdated.
 * @param {string} currentVersion - Current package version
 * @param {boolean} jsonMode - Suppress output in JSON mode
 */
export async function checkForUpdates(currentVersion, jsonMode) {
    if (jsonMode) return;

    try {
        const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const { version: latest } = await res.json();

        if (latest && latest !== currentVersion) {
            warning(`Update available: ${currentVersion} → ${latest}. Run: zalo-agent update`);
        }
    } catch {
        // Silent failure — network issues shouldn't block CLI usage
    }
}

/**
 * Self-update by running `bun add -g zalo-agent-cli@latest`.
 * @returns {Promise<boolean>} success
 */
export function selfUpdate() {
    return new Promise((resolve) => {
        const child = spawn("bun", ["add", "-g", "zalo-agent-cli@latest"], { stdio: "inherit", timeout: 60000 });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
}
