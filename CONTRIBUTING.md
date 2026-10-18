# Contributing

Thanks for helping. Bug reports, new sources and fixes are all welcome.

## Before you start

- **Open an issue first** describing the problem or the change, so the approach can be
  agreed before code is written. Every pull request closes an issue.
- **A new provider of an existing type** usually needs no change here: an external
  provider module or an inline agent source works from config alone (see
  [docs/sources.md](docs/sources.md)). Propose it as a built-in once it has proven useful.
- **Security issues** go to a private security advisory on the repository, not a public
  issue.

## Making a change

1. Branch from the latest `main`, one change per branch.
2. Keep each commit to about 250 changed lines, not counting tests and config. Split a
   larger change into several pull requests, each based on the one before it, and say in
   each which part of the whole it is.
3. Build, format, lint and test before pushing:

   ```bash
   pnpm install
   pnpm build
   pnpm format
   pnpm lint
   pnpm test
   ```

4. Add or update tests with the change. Dashboard changes should also be checked in a
   browser at desktop and phone widths.
5. Open a pull request that says `Closes #<issue>` and describes what changed and how it
   was checked.

A pull request merges after review approval and green CI.

## Style

- TypeScript with ES modules, formatted and linted by Biome. The dashboard is plain
  JavaScript with no build step.
- Comments are short, and only where the code does not explain itself.
- Code and docs describe how things work now. History belongs in commit messages, not in
  comments or docs, and neither refers to issue or pull request numbers.
- Commit messages: a short `<package>: <what changed>` subject, then a plain paragraph on
  what and why.
- Keep the wire contract in `packages/core` backward compatible, or change the hub and
  reporter together in the same release.

## Never commit

Private keys (`*.key`), identity files (`*.pub.json`), assembled configs
(`hub-config.json`, `config.json`, `instances*.json`, `bootstrap.json`,
`signed-registry.json`, `accounts.conf`), Terraform variables or state, or any token.
`.gitignore` covers these; check `git status` before every commit.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
