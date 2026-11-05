/**
 * Quick message commands — list, add, update, remove saved quick messages.
 */

import type { Command } from "commander";
import { getApi } from "../core/zalo-client.ts";
import { success, error, output } from "../utils/output.ts";
import { errorMessage } from "../utils/error-message.ts";

export function registerQuickMsgCommands(program: Command): void {
    const qm = program.command("quick-msg").description("Manage quick/saved messages");

    qm.command("list")
        .description("List all quick messages")
        .action(async () => {
            try {
                const result = await getApi().getQuickMessageList();
                output(result, program.opts().json);
            } catch (e) {
                error(`Get quick messages failed: ${errorMessage(e)}`);
            }
        });

    qm.command("add <keyword> <title>")
        .description("Add a quick message")
        .action(async (keyword: string, title: string) => {
            try {
                const result = await getApi().addQuickMessage({ keyword, title });
                output(result, program.opts().json, () => success(`Quick message added: "${keyword}" → "${title}"`));
            } catch (e) {
                error(`Add quick message failed: ${errorMessage(e)}`);
            }
        });

    qm.command("update <itemId> <keyword> <title>")
        .description("Update a quick message")
        .action(async (itemId: string, keyword: string, title: string) => {
            try {
                const result = await getApi().updateQuickMessage({ keyword, title }, Number(itemId));
                output(result, program.opts().json, () => success(`Quick message ${itemId} updated`));
            } catch (e) {
                error(`Update quick message failed: ${errorMessage(e)}`);
            }
        });

    qm.command("remove <itemIds...>")
        .description("Remove quick message(s)")
        .action(async (itemIds: string[]) => {
            try {
                const ids = itemIds.map(Number);
                const result = await getApi().removeQuickMessage(ids);
                output(result, program.opts().json, () => success(`Removed ${ids.length} quick message(s)`));
            } catch (e) {
                error(`Remove quick message failed: ${errorMessage(e)}`);
            }
        });
}
