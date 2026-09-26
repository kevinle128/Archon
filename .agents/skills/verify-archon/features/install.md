# CLI discovery

## Sub-features

Version and help, workflow discovery, and workflow definition validation.

## How to get to it (user POV)

Run `archon version`, `archon --help`, `archon workflow list --json`, and `archon validate workflows <name> --json` inside a project.
From source, use `bun "$TARGET/packages/cli/src/cli.ts"` instead of the installed executable.

## Driving it with the CLI harness

Run recipe `install.health`.
It creates a disposable project and starts the real CLI for each command.
The version must match the target manifest, help must expose workflow commands, and discovery must list the fixture workflow.
A valid DAG must pass validation.
A DAG referencing a missing dependency must return a validation error with a nonzero exit.
The retained transcript records argv, output, exit codes, and cleanup.

## Gotchas

Use the target checkout's dependencies.
The fixture has a private Archon home and does not use the operator's database.
Git is needed to create the disposable fixture project; the target checkout does not need a pinned commit.
