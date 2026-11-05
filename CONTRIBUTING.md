# Contributing to zalo-agent-cli

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/cuongtranba/zalo-agent-cli.git
cd zalo-agent-cli

# Install dependencies (Bun >= 1.4.2; the repo pins the version in .bun-version)
bun install

# Link globally for local testing
bun link

# Verify
zalo-agent --version

# Run all checks (typecheck, lint, format check, tests)
bun run check
```

Scripts:

| Script | What it does |
|--------|--------------|
| `bun run typecheck` | `tsc --noEmit` (strict) |
| `bun run lint` / `bun run lint:fix` | oxlint (see below) |
| `bun run format:check` / `bun run format` | Prettier |
| `bun test` | Test suite on `bun:test` |
| `bun run build:bin` | Standalone binary in `dist/` |
| `bun run check` | Typecheck, lint, format check and tests in sequence |

## Code Style

- **TypeScript, Bun only** — sources are `.ts` and run directly on Bun (no build step, Node is not supported)
- **ESM modules** — use `import`/`export`, never `require()`; import local files with the `.ts` extension
- **Strict types** — no explicit `any`, no non-null assertions (`!`), `import type` for type-only imports
- **No `var`** — use `const` by default, `let` when reassignment needed
- **Async/await** — no raw `.then()` chains
- **4-space indentation** — enforced by Prettier
- **Double quotes** — enforced by Prettier
- **Semicolons** — always

### Lint & Format

Linting uses [oxlint](https://oxc.rs) with the rules in `.oxlintrc.json`: correctness and suspicious rules are errors, warnings fail the run, and unused disable directives are reported. Formatting uses Prettier.

```bash
# Check for issues
bun run lint
bun run format:check

# Auto-fix
bun run lint:fix
bun run format
```

All PRs must pass `bun run check`.

Suppressions must be targeted and explain themselves, for example `// oxlint-disable-next-line typescript/no-explicit-any -- reason`. `@ts-expect-error` needs a description and `@ts-ignore` is banned.

> `bun lint` (a built-in linter) exists only in Bun canary builds today and reads `.oxlintrc.json` directly. When it ships in a stable Bun release, switching is a change to the `lint` scripts in `package.json`; the config stays as is.

## Project Structure

See the Layout section of [AGENTS.md](AGENTS.md).

## Adding a New Command

1. Find the appropriate file in `src/commands/`
2. Follow the existing pattern:

```ts
subcommand.command("my-command <arg>")
    .description("What it does")
    .option("-x, --flag <value>", "Description")
    .action(async (arg: string, opts: { flag?: string }) => {
        try {
            const api = getApi();
            const result = await api.someMethod(arg);
            output(result, program.opts().json, () => success("Done"));
        } catch (e) {
            error(errorMessage(e));
        }
    });
```

3. Always support `--json` output via the `output()` helper
4. Use `success()`, `error()`, `info()`, `warning()` for human output
5. Use `getApi()` for Zalo API access (throws if not logged in)

## Security Rules

**CRITICAL — violations will result in PR rejection:**

- **NEVER** log credentials, cookies, IMEI, or proxy passwords
- **NEVER** commit test credentials, user IDs, or phone numbers
- **ALWAYS** use `maskProxy()` when displaying proxy URLs
- **ALWAYS** set 0600 permissions on credential files
- **NEVER** use `execSync()` or `exec()` with user-supplied input (command injection)
- **NEVER** commit `.env`, `accounts.json`, or anything from `~/.zalo-agent-cli/`

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add video message support
fix: handle expired QR gracefully
docs: update proxy setup guide
refactor: extract shared QR logic
```

## Pull Request Process

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes + ensure `bun run check` passes
4. Write clear commit messages
5. Push and open a PR against `main`
6. Describe what changed and why in the PR description

## Testing

```bash
# Run tests
bun test

# Manual testing — login and verify commands work
zalo-agent login
zalo-agent msg send THREAD_ID "test"
zalo-agent account list
```

## Reporting Issues

- Search existing issues first
- Include: Bun version (`bun --version`), OS, error message, steps to reproduce
- **NEVER** include credentials, cookies, or proxy passwords in issues

## Code of Conduct

Be respectful, constructive, and professional. We're all here to build something useful.
