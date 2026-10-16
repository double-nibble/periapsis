# Reporter install (macOS)

Brings a periapsis reporter online on a subaccount machine as a launchd agent.

## Steps

1. Run the installer. On first run it clones and builds the repo, generates this
   account's keypair, and writes a starter config.

   ```
   curl -fsSL https://raw.githubusercontent.com/double-nibble/periapsis/main/packages/reporter/install/install.sh | bash
   ```

   The private key is written to `~/.periapsis/<account>.key` and never leaves
   the machine.

2. Edit `~/.periapsis/config.json`:
   - `rootSignPublic` — the pinned root public key from the operator.
   - each instance's provider token and params.

3. Register this account's **public** key (`~/.periapsis/<account>.pub.json`)
   with the operator, who signs it into the registry.

4. Re-run the installer. It registers the LaunchAgent and starts the reporter.

## Managing

- Logs: `~/.periapsis/reporter.log`
- Stop: `launchctl unload ~/Library/LaunchAgents/com.double-nibble.periapsis-reporter.plist`
- Update: re-run the installer (it pulls and rebuilds).
