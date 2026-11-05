#!/usr/bin/env bun

/**
 * zalo-agent-cli — CLI for Zalo automation with multi-account + proxy support.
 * Entry point: registers all command groups via Commander.js.
 */

import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerLoginCommands } from "./commands/login.ts";

import { registerMsgCommands } from "./commands/msg.ts";
import { registerFriendCommands } from "./commands/friend.ts";
import { registerGroupCommands } from "./commands/group.ts";
import { registerConvCommands } from "./commands/conv.ts";
import { registerAccountCommands } from "./commands/account.ts";
import { registerProfileCommands } from "./commands/profile.ts";
import { registerPollCommands } from "./commands/poll.ts";
import { registerReminderCommands } from "./commands/reminder.ts";
import { registerAutoReplyCommands } from "./commands/auto-reply.ts";
import { registerQuickMsgCommands } from "./commands/quick-msg.ts";
import { registerLabelCommands } from "./commands/label.ts";
import { registerCatalogCommands } from "./commands/catalog.ts";
import { registerListenCommand } from "./commands/listen.ts";
import { registerOACommands } from "./commands/oa.ts";
import { registerMCPCommands } from "./commands/mcp.ts";
import { autoLogin } from "./core/zalo-client.ts";
import { checkForUpdates, selfUpdate } from "./utils/update-check.ts";
import { success, error, warning } from "./utils/output.ts";

const DISCLAIMER = "This tool uses unofficial Zalo APIs (zca-js) — your account may be banned. Use at your own risk.";

const program = new Command();

program
    .name("zalo-agent")
    .description("CLI tool for Zalo automation — multi-account, proxy, bank transfers, QR payments")
    .version(pkg.version)
    .option("--json", "Output results as JSON (machine-readable)")
    .hook("preAction", async (thisCommand) => {
        const cmdName = thisCommand.args?.[0] || thisCommand.name();
        // Suppress zca-js internal logs in JSON mode to keep stdout clean for piping
        if (program.opts().json || cmdName === "mcp") {
            // Suppress zca-js stdout logs: JSON mode needs clean output, MCP uses stdout as transport
            process.env.ZALO_JSON_MODE = "1";
        } else if (cmdName !== "oa") {
            // OA commands use official Zalo API — no disclaimer needed
            warning(DISCLAIMER);
            console.log();
        }
        // Auto-login before any command that needs it (skip for login/account/oa commands)
        const skipAutoLogin = ["login", "account", "help", "version", "update", "oa", "mcp"].includes(cmdName);
        if (!skipAutoLogin) {
            await autoLogin(program.opts().json);
        }
        // Non-blocking update check (skip for update command itself and mcp, whose stdout is the protocol channel)
        if (cmdName !== "update" && cmdName !== "mcp") {
            await checkForUpdates(pkg.version, program.opts().json);
        }
    });

// Self-update command
program
    .command("update")
    .description("Update zalo-mcp to the latest version")
    .action(async () => {
        const ok = await selfUpdate();
        if (ok) success(`Updated to latest version`);
        else error("Update failed. Try manually: bun add -g zalo-mcp@latest");
    });

// Register all command groups
registerLoginCommands(program);
registerMsgCommands(program);
registerFriendCommands(program);
registerGroupCommands(program);
registerConvCommands(program);
registerAccountCommands(program);
registerProfileCommands(program);
registerPollCommands(program);
registerReminderCommands(program);
registerAutoReplyCommands(program);
registerQuickMsgCommands(program);
registerLabelCommands(program);
registerCatalogCommands(program);
registerListenCommand(program);
registerOACommands(program);
registerMCPCommands(program);

program.parse();
