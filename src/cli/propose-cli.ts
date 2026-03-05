import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the Python binary by walking up from this file until we find
 * a .venv/bin/<name>. Works from both src/cli/ and dist/.
 */
function resolvePythonBin(name: string): string {
  let dir = import.meta.dirname ?? __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".venv", "bin", name);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return name;
}

/**
 * Register the `propose` command as a thin shim that delegates to the
 * Python `openclaw-propose` entry point (installed from the
 * packages/orchestration package).
 *
 * All arguments and flags are passed through verbatim so the Python CLI
 * handles its own parsing.
 */
export function registerProposeCli(program: Command) {
  const propose = program
    .command("propose [outcome...]")
    .description("Generate scored topology proposals for a given outcome")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .addHelpText(
      "after",
      `
Examples:
  openclaw propose "build a chat app"
  openclaw propose --json "deploy ML pipeline"
  openclaw propose --fresh --project myproj "refactor auth service"
  openclaw propose memory
  openclaw propose memory --detail

Note: This command delegates to the \`openclaw-propose\` Python CLI.
      Install it via: uv pip install -e packages/orchestration
`,
    );

  propose.action((_outcome, _opts, cmd) => {
    // Forward all raw args after "propose" to the Python binary.
    const passthroughArgs = process.argv.slice(process.argv.indexOf("propose") + 1);
    const bin = resolvePythonBin("openclaw-propose");

    const result = spawnSync(bin, passthroughArgs, {
      stdio: "inherit",
      env: process.env,
    });

    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(
          "[openclaw] `openclaw-propose` not found on PATH.\n" +
            "Install the Python orchestration package: uv pip install -e packages/orchestration",
        );
      } else {
        console.error("[openclaw] Failed to run openclaw-propose:", result.error.message);
      }
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  });
}
