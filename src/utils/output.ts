/**
 * Output formatting utilities — JSON mode and colored human-readable output.
 */

import chalk from "chalk";

/** Emit JSON or call human formatter based on --json flag. */
export function output<T>(data: T, jsonMode: boolean | undefined, humanFormatter?: (data: T) => void): void {
    if (jsonMode) {
        console.log(JSON.stringify(data, null, 2));
    } else if (humanFormatter) {
        humanFormatter(data);
    } else {
        console.log(JSON.stringify(data, null, 2));
    }
}

export const success = (msg: string) => console.log(chalk.green("  ✓ " + msg));
export const error = (msg: string) => console.log(chalk.red("  ✗ " + msg));
export const info = (msg: string) => console.log(chalk.cyan("  ● " + msg));
export const warning = (msg: string) => console.log(chalk.yellow("  ⚠ " + msg));
