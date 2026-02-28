# Releasing

## Where Things Are Published

| Package | Registry | URL |
|---------|----------|-----|
| **sogo-lite** | VS Code Marketplace | https://marketplace.visualstudio.com/items?itemName=shucho.sogo-lite |
| **sogo-db-core** | npm | https://www.npmjs.com/package/sogo-db-core |
| **sogo-mcp-server** | npm | https://www.npmjs.com/package/sogo-mcp-server |

Marketplace management: https://marketplace.visualstudio.com/manage/publishers/shucho/extensions/sogo-lite/hub

Publisher: `shucho`

## Release Steps

### 1. Bump versions

Update `version` in the relevant `package.json` files:

- `packages/core/package.json` — if core changed
- `packages/mcp-server/package.json` — if MCP server changed
- `packages/extension/package.json` — if extension changed

If core changed and MCP server depends on the new version, bump the MCP server too. The `workspace:*` dependency protocol auto-resolves to the real version during `pnpm publish`.

The extension bundles core via esbuild, so a core-only change doesn't require bumping the MCP server — but you do need to rebuild the extension to pick up core changes.

### 2. Build and test

```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

All must pass.

### 3. Publish npm packages

```bash
pnpm publish:core    # sogo-db-core → npm
pnpm publish:mcp     # sogo-mcp-server → npm
```

Or both in order:

```bash
pnpm publish:npm
```

**Auth**: Must be logged in via `npm login`. Account has 2FA enabled — use a granular access token with bypass, or provide OTP when prompted.

### 4. Publish VS Code extension

Generate `.vsix` only:

```bash
pnpm package:ext     # → packages/extension/sogo-lite-X.Y.Z.vsix
```

Publish to marketplace:

```bash
pnpm publish:ext
```

**Auth**: Must be logged in via `npx vsce login shucho`. Requires an Azure DevOps PAT with:
- Organization: **All accessible organizations**
- Scopes: **Marketplace > Acquire + Manage** (click "Show all scopes" to find it)

### 5. Or do it all at once

```bash
pnpm release         # build → test → publish npm → package .vsix
```

Note: `pnpm release` packages the `.vsix` but does not publish it to the marketplace. Run `pnpm publish:ext` separately for that.

### 6. Commit and tag

```bash
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

## Installing from .vsix

For sharing without the marketplace:

```bash
code --install-extension packages/extension/sogo-lite-X.Y.Z.vsix
```
