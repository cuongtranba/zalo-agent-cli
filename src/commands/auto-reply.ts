/**
 * Auto-reply commands — list, create, update, delete auto-reply messages.
 */

import type { Command } from "commander";
import type { AutoReplyScope, CreateAutoReplyPayload, UpdateAutoReplyPayload } from "zca-js";
import { getApi } from "../core/zalo-client.ts";
import { success, error, output } from "../utils/output.ts";
import { errorMessage } from "../utils/error-message.ts";

export function registerAutoReplyCommands(program: Command): void {
    const ar = program.command("auto-reply").description("Manage auto-reply messages");

    ar.command("list")
        .description("List all auto-reply rules")
        .action(async () => {
            try {
                const result = await getApi().getAutoReplyList();
                output(result, program.opts().json);
            } catch (e) {
                error(`Get auto-reply list failed: ${errorMessage(e)}`);
            }
        });

    ar.command("create <content>")
        .description("Create an auto-reply rule")
        .option("--enable", "Enable the rule (default: true)", true)
        .option("--no-enable", "Create disabled")
        .option("--start <ms>", "Start time (epoch ms)", parseInt, 0)
        .option("--end <ms>", "End time (epoch ms)", parseInt, 0)
        .option("--scope <n>", "Scope: 0=all, 1=friends, 2=strangers", parseInt, 0)
        .option("--uids <ids...>", "Specific user IDs to auto-reply to")
        .action(
            async (
                content: string,
                opts: { enable: boolean; start: number; end: number; scope: number; uids?: string[] },
            ) => {
                try {
                    const payload: CreateAutoReplyPayload = {
                        content,
                        isEnable: opts.enable,
                        startTime: opts.start,
                        endTime: opts.end,
                        // CLI input is not validated against the enum; Zalo rejects out-of-range scopes
                        scope: opts.scope as AutoReplyScope,
                    };
                    if (opts.uids) payload.uids = opts.uids;
                    const result = await getApi().createAutoReply(payload);
                    output(result, program.opts().json, () => success("Auto-reply created"));
                } catch (e) {
                    error(`Create auto-reply failed: ${errorMessage(e)}`);
                }
            },
        );

    ar.command("update <id> <content>")
        .description("Update an auto-reply rule")
        .option("--enable", "Enable the rule")
        .option("--no-enable", "Disable the rule")
        .option("--start <ms>", "Start time (epoch ms)", parseInt, 0)
        .option("--end <ms>", "End time (epoch ms)", parseInt, 0)
        .option("--scope <n>", "Scope: 0=all, 1=friends, 2=strangers", parseInt, 0)
        .option("--uids <ids...>", "Specific user IDs")
        .action(
            async (
                id: string,
                content: string,
                opts: { enable?: boolean; start: number; end: number; scope: number; uids?: string[] },
            ) => {
                try {
                    const payload: UpdateAutoReplyPayload = {
                        id: Number(id),
                        content,
                        isEnable: opts.enable ?? true,
                        startTime: opts.start,
                        endTime: opts.end,
                        // CLI input is not validated against the enum; Zalo rejects out-of-range scopes
                        scope: opts.scope as AutoReplyScope,
                    };
                    if (opts.uids) payload.uids = opts.uids;
                    const result = await getApi().updateAutoReply(payload);
                    output(result, program.opts().json, () => success(`Auto-reply ${id} updated`));
                } catch (e) {
                    error(`Update auto-reply failed: ${errorMessage(e)}`);
                }
            },
        );

    ar.command("delete <id>")
        .description("Delete an auto-reply rule")
        .action(async (id: string) => {
            try {
                const result = await getApi().deleteAutoReply(Number(id));
                output(result, program.opts().json, () => success(`Auto-reply ${id} deleted`));
            } catch (e) {
                error(`Delete auto-reply failed: ${errorMessage(e)}`);
            }
        });
}
