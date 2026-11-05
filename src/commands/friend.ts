/**
 * Friend commands — list, find, info, add, accept, remove, block, unblock, last-online, online.
 */

import type { Command } from "commander";
import { getApi } from "../core/zalo-client.ts";
import { success, error, info, output } from "../utils/output.ts";
import { errorMessage } from "../utils/error-message.ts";

/**
 * A user record as Zalo returns it. Field naming differs per endpoint (camelCase or snake_case) and the
 * response is sometimes wrapped in `data`, so the formatters probe all variants.
 */
interface UserLike {
    uid?: string;
    userId?: string;
    displayName?: string;
    zaloName?: string;
    display_name?: string;
    zalo_name?: string;
    data?: UserLike;
}

/** Extract numeric error code from zca-js error message string. */
function extractErrorCode(msg: unknown): number | null {
    const match = String(msg).match(/\((\-?\d+)\)/);
    return match ? Number(match[1]) : null;
}

export function registerFriendCommands(program: Command): void {
    const friend = program.command("friend").description("Manage friends and contacts");

    friend
        .command("list")
        .description("List all friends")
        .action(async () => {
            try {
                const result = await getApi().getAllFriends();
                output(result, program.opts().json, () => {
                    const profiles: object =
                        (result as { changed_profiles?: object })?.changed_profiles || result || {};
                    const entries = Object.entries(profiles) as [string, UserLike][];
                    info(`${entries.length} friends`);
                    for (const [uid, p] of entries) {
                        console.log(`  ${uid}  ${p.displayName || p.zaloName || "?"}`);
                    }
                });
            } catch (e) {
                error(errorMessage(e));
            }
        });

    friend
        .command("online")
        .description("List currently online friends")
        .action(async () => {
            try {
                const result = await getApi().getFriendOnlines();
                output(result, program.opts().json);
            } catch (e) {
                error(errorMessage(e));
            }
        });

    friend
        .command("search <name>")
        .description("Search friends by name (returns thread_id for messaging)")
        .action(async (name: string) => {
            try {
                const result = await getApi().getAllFriends();
                const friends = Array.isArray(result) ? result : [];
                const query = name.toLowerCase();
                const matches = friends.filter((f) => {
                    const dn = (f.displayName || "").toLowerCase();
                    const zn = (f.zaloName || "").toLowerCase();
                    return dn.includes(query) || zn.includes(query);
                });
                output(matches, program.opts().json, () => {
                    if (matches.length === 0) {
                        error(`No friends matching "${name}". Use "friend list" to see all.`);
                        return;
                    }
                    info(`${matches.length} friend(s) matching "${name}":`);
                    console.log();
                    for (const f of matches) {
                        const display = f.displayName || f.zaloName || "?";
                        console.log(`  ${f.userId}  ${display}`);
                    }
                    console.log();
                    info("Use the ID above as thread_id for messaging commands.");
                    info('Example: zalo-agent msg send <thread_id> "Hello"');
                });
            } catch (e) {
                error(errorMessage(e));
            }
        });

    friend
        .command("find <query>")
        .description("Find user by phone number or Zalo ID")
        .action(async (query: string) => {
            try {
                const result: UserLike = await getApi().findUser(query);
                if (!result || (!result.uid && !result?.data?.uid)) {
                    error(
                        `No Zalo user found for "${query}". User may not exist, has disabled phone search, or phone is not registered on Zalo.`,
                    );
                    return;
                }
                output(result, program.opts().json, () => {
                    const u = result?.uid ? result : result?.data || result;
                    info(`User ID: ${u.uid || "?"}`);
                    info(`Name: ${u.displayName || u.zaloName || u.display_name || u.zalo_name || "?"}`);
                });
            } catch (e) {
                error(`Find user failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("info <userId>")
        .description("Get user profile information")
        .action(async (userId: string) => {
            try {
                const result = await getApi().getUserInfo(userId);
                output(result, program.opts().json, () => {
                    const profiles = result?.changed_profiles || {};
                    const p = profiles[userId] || {};
                    info(`Name: ${p.displayName || p.zaloName || "?"}`);
                    info(`Phone: ${p.phoneNumber || "?"}`);
                    info(`Avatar: ${p.avatar || "?"}`);
                });
            } catch (e) {
                error(errorMessage(e));
            }
        });

    friend
        .command("add <userId>")
        .description("Send a friend request")
        .option("-m, --msg <text>", "Message to include", "")
        .action(async (userId: string, opts: { msg: string }) => {
            try {
                // zca-js API signature: sendFriendRequest(msg, userId)
                const result = await getApi().sendFriendRequest(opts.msg, userId);
                output(result, program.opts().json, () => success(`Friend request sent to ${userId}`));
            } catch (e) {
                // Map Zalo error codes to actionable messages
                const code = (e as { code?: number }).code || extractErrorCode(errorMessage(e));
                const errMap: Record<string, string> = {
                    225: `Already friends with ${userId}. Use "friend list" to verify.`,
                    215: `User ${userId} may have blocked you or is unreachable.`,
                    222: `User ${userId} already sent you a friend request. Use "friend accept ${userId}" instead.`,
                    "-1": `Invalid userId "${userId}". Use "friend find <phone>" to get the correct userId first.`,
                };
                error(errMap[String(code)] || `Friend request failed (code ${code}): ${errorMessage(e)}`);
            }
        });

    friend
        .command("accept <userId>")
        .description("Accept a friend request")
        .action(async (userId: string) => {
            try {
                const result = await getApi().acceptFriendRequest(userId);
                output(result, program.opts().json, () => success(`Accepted friend request from ${userId}`));
            } catch (e) {
                error(`Accept friend request failed for ${userId}: ${errorMessage(e)}`);
            }
        });

    friend
        .command("remove <userId>")
        .description("Remove a friend")
        .action(async (userId: string) => {
            try {
                const result = await getApi().removeFriend(userId);
                output(result, program.opts().json, () => success(`Removed friend ${userId}`));
            } catch (e) {
                error(`Remove friend failed for ${userId}: ${errorMessage(e)}`);
            }
        });

    friend
        .command("block <userId>")
        .description("Block a user")
        .action(async (userId: string) => {
            try {
                const result = await getApi().blockUser(userId);
                output(result, program.opts().json, () => success(`Blocked user ${userId}`));
            } catch (e) {
                error(`Block user failed for ${userId}: ${errorMessage(e)}`);
            }
        });

    friend
        .command("unblock <userId>")
        .description("Unblock a user")
        .action(async (userId: string) => {
            try {
                const result = await getApi().unblockUser(userId);
                output(result, program.opts().json, () => success(`Unblocked user ${userId}`));
            } catch (e) {
                error(`Unblock user failed for ${userId}: ${errorMessage(e)}`);
            }
        });

    friend
        .command("last-online <userId>")
        .description("Check when user was last online")
        .action(async (userId: string) => {
            try {
                // @ts-expect-error pre-existing: zca-js has no getLastOnline (it is lastOnline); the command fails at runtime
                const result = await getApi().getLastOnline(userId);
                output(result, program.opts().json);
            } catch (e) {
                error(errorMessage(e));
            }
        });

    friend
        .command("find-username <username>")
        .description("Find a user by their Zalo username")
        .action(async (username: string) => {
            try {
                const result: UserLike | null = await getApi().findUserByUsername(username);
                output(result, program.opts().json, () => {
                    if (!result) {
                        error(`No user found for username "${username}"`);
                        return;
                    }
                    info(`User ID: ${result.uid || "?"}`);
                    info(`Name: ${result.displayName || result.zaloName || "?"}`);
                });
            } catch (e) {
                error(`Find username failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("alias <friendId> <alias>")
        .description("Set a nickname (alias) for a friend")
        .action(async (friendId: string, alias: string) => {
            try {
                const result = await getApi().changeFriendAlias(alias, friendId);
                output(result, program.opts().json, () => success(`Alias set to "${alias}" for ${friendId}`));
            } catch (e) {
                error(`Set alias failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("alias-list")
        .description("List all friend aliases")
        .option("-c, --count <n>", "Page size", parseInt, 100)
        .option("-p, --page <n>", "Page number", parseInt, 1)
        .action(async (opts: { count: number; page: number }) => {
            try {
                const result = await getApi().getAliasList(opts.count, opts.page);
                output(result, program.opts().json, () => {
                    const items = result?.items || [];
                    info(`${items.length} alias(es)`);
                    for (const item of items) {
                        console.log(`  ${item.userId}  ${item.alias}`);
                    }
                });
            } catch (e) {
                error(`Get alias list failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("alias-remove <friendId>")
        .description("Remove a friend's alias")
        .action(async (friendId: string) => {
            try {
                const result = await getApi().removeFriendAlias(friendId);
                output(result, program.opts().json, () => success(`Alias removed for ${friendId}`));
            } catch (e) {
                error(`Remove alias failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("reject <userId>")
        .description("Reject a friend request")
        .action(async (userId: string) => {
            try {
                const result = await getApi().rejectFriendRequest(userId);
                output(result, program.opts().json, () => success(`Rejected friend request from ${userId}`));
            } catch (e) {
                error(`Reject friend request failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("undo-request <userId>")
        .description("Cancel a sent friend request")
        .action(async (userId: string) => {
            try {
                const result = await getApi().undoFriendRequest(userId);
                output(result, program.opts().json, () => success(`Friend request to ${userId} cancelled`));
            } catch (e) {
                error(`Undo friend request failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("sent-requests")
        .description("List all sent friend requests")
        .action(async () => {
            try {
                const result = await getApi().getSentFriendRequest();
                output(result, program.opts().json, () => {
                    const entries = Object.entries(result || {});
                    info(`${entries.length} sent request(s)`);
                    for (const [uid, req] of entries) {
                        console.log(`  ${uid}  ${req.displayName || req.zaloName || "?"}`);
                    }
                });
            } catch (e) {
                // Code 112 = no friend requests
                if (String(errorMessage(e)).includes("112")) {
                    info("No sent friend requests");
                } else {
                    error(`Get sent requests failed: ${errorMessage(e)}`);
                }
            }
        });

    friend
        .command("request-status <userId>")
        .description("Check friend request status with a user")
        .action(async (userId: string) => {
            try {
                const result = await getApi().getFriendRequestStatus(userId);
                output(result, program.opts().json, () => {
                    info(`is_friend: ${result.is_friend}`);
                    info(`is_requested: ${result.is_requested}`);
                    info(`is_requesting: ${result.is_requesting}`);
                });
            } catch (e) {
                error(`Get request status failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("close")
        .description("List close friends")
        .action(async () => {
            try {
                const result = await getApi().getCloseFriends();
                output(result, program.opts().json, () => {
                    const friends: UserLike[] = Array.isArray(result) ? result : [];
                    info(`${friends.length} close friend(s)`);
                    for (const f of friends) {
                        console.log(`  ${f.userId || f.uid || "?"}  ${f.displayName || f.zaloName || "?"}`);
                    }
                });
            } catch (e) {
                error(`Get close friends failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("recommendations")
        .description("Get friend recommendations and received requests")
        .action(async () => {
            try {
                const result = await getApi().getFriendRecommendations();
                output(result, program.opts().json, () => {
                    const items = result?.recommItems || [];
                    info(`${items.length} recommendation(s)`);
                    for (const item of items) {
                        const d = item.dataInfo || {};
                        const type = d.recommType === 2 ? "[request]" : "[suggest]";
                        console.log(`  ${d.userId}  ${d.displayName || d.zaloName || "?"}  ${type}`);
                    }
                });
            } catch (e) {
                error(`Get recommendations failed: ${errorMessage(e)}`);
            }
        });

    friend
        .command("find-phones <phones...>")
        .description("Find users by phone numbers")
        .action(async (phones: string[]) => {
            try {
                const result = await getApi().getMultiUsersByPhones(phones);
                output(result, program.opts().json, () => {
                    const entries = Object.entries(result || {}) as [string, UserLike][];
                    info(`${entries.length} user(s) found`);
                    for (const [phone, user] of entries) {
                        console.log(`  ${phone}  ${user.uid || "?"}  ${user.displayName || user.zaloName || "?"}`);
                    }
                });
            } catch (e) {
                error(`Find by phone failed: ${errorMessage(e)}`);
            }
        });
}
