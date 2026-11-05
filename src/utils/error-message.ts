/** Message of a caught value. Anything thrown that is not an Error is stringified. */
export function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
