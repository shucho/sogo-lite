# Sogo Lite

## Note: This is work based on the idea of [adamking77](https://github.com/adamking77) who first suggested this idea to me.

Notion-style databases inside VS Code. Create, view, and edit `.db.json` files as interactive tables, kanban boards, calendars, galleries, and lists — right in your editor.

Pair it with the MCP server to give AI agents (Claude, Cursor, Copilot) full CRUD access to the same databases.

## Install

**VS Code Extension** — search "Sogo Lite" in the extensions panel, or:

```
ext install shucho.sogo-lite
```

**MCP Server** (optional, for AI agent access):

```bash
npx sogo-mcp-server
```

**Core Library** (if building on top of sogo-db):

```bash
npm install sogo-db-core
```

## How It Works

Every database is a single `.db.json` file. Drop one in your project and the extension opens it as an interactive UI — no server, no config, no account.

```jsonc
{
  "id": "uuid",
  "name": "Tasks",
  "schema": [
    { "id": "f-title", "name": "Title", "type": "text" },
    { "id": "f-status", "name": "Status", "type": "status" },
    { "id": "f-due", "name": "Due Date", "type": "date" }
  ],
  "views": [
    { "id": "v-table", "name": "All Tasks", "type": "table" }
  ],
  "records": [
    { "id": "rec-001", "f-title": "Ship v1", "f-status": "In progress", "f-due": "2026-03-01" }
  ]
}
```

Databases live in two places:

- **Global** (`~/.sogo/globalDatabases/`) — visible in every workspace. Use for CRM, clients, project tracking.
- **Workspace** — any `.db.json` file in your project tree.

Both show up in the Databases sidebar panel.

## Views

| View | What it does |
|------|-------------|
| **Table** | Spreadsheet-style grid with inline editing, sorting, filtering, column visibility |
| **Kanban** | Drag-and-drop cards grouped by status or select fields |
| **Calendar** | Month grid with records placed on date fields |
| **Gallery** | Card grid with field summaries |
| **List** | Compact row-based view |

Switch between views with the tab bar. Each view has its own sort, filter, and field visibility settings.

## Features

- **Inline editing** — click any cell in table view to edit it
- **Drag and drop** — move cards between kanban columns
- **Record editor** — full-screen modal for editing all fields at once
- **Schema editor** — add, remove, rename, and reorder fields
- **Sort & filter** — multi-field sorting and filtering with operators (equals, contains, greater than, etc.)
- **Field types** — text, number, select, multiselect, date, checkbox, url, email, phone, status, relation, rollup, formula, createdAt, lastEditedAt
- **Create from command palette** — `Sogo DB: Create Database` scaffolds a new `.db.json`
- **CSV import/export** — bring data in or out
- **File watching** — external changes (git pull, AI edits) are picked up automatically
- **Theme integration** — respects your VS Code color theme

## MCP Server

Give AI agents structured access to your databases. Add to your Claude Desktop config, `.mcp.json`, or Claude Code settings:

```json
{
  "mcpServers": {
    "sogo-db": {
      "command": "npx",
      "args": ["sogo-mcp-server"],
      "env": {
        "SOGO_GLOBAL_PATH": "~/.sogo/globalDatabases",
        "SOGO_WORKSPACE_PATH": "."
      }
    }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `list_databases` | List all databases (global + workspace) with schemas |
| `get_database_schema` | Get field definitions and views for a database |
| `list_records` | List records with optional filter, sort, and pagination |
| `create_record` | Create a new record using field names |
| `update_record` | Update specific fields of a record by name |
| `delete_record` | Delete a record from a database |
| `search_records` | Full-text search across databases |

All tools accept **field names** (e.g., "Status", "Priority") — no UUIDs needed. Database lookup is fuzzy: `"clients"` matches `"Clients"`, `"work"` matches `"Work Items"`.

### Examples

```
list_records({ database: "Clients", filter: [{ field: "Status", op: "equals", value: "Active" }] })

create_record({ database: "Tasks", values: { Title: "Review PR", Status: "Not started", Priority: "High" } })

search_records({ query: "landing page" })
```

### Configuration

| Env Variable | Default | Description |
|---|---|---|
| `SOGO_GLOBAL_PATH` | `~/.sogo/globalDatabases` | Path to global databases directory |
| `SOGO_WORKSPACE_PATH` | `.` (current directory) | Workspace root to scan for `.db.json` files |
| `SOGO_SCAN_DEPTH` | `3` | Directory levels deep to scan |

## Packages

This is a pnpm monorepo with three packages:

| Package | npm | Description |
|---------|-----|-------------|
| `sogo-lite` | [Marketplace](https://marketplace.visualstudio.com/items?itemName=shucho.sogo-lite) | VS Code extension — visual editor for `.db.json` files |
| `sogo-mcp-server` | [npm](https://www.npmjs.com/package/sogo-mcp-server) | MCP server — AI agent access via 7 tools |
| `sogo-db-core` | [npm](https://www.npmjs.com/package/sogo-db-core) | Shared library — types, sort/filter, formulas, rollups, CSV, schema migration |

## Development

```bash
git clone https://github.com/shucho/sogo-db.git
cd sogo-db
pnpm install
pnpm -r build        # Build all packages
pnpm -r typecheck    # TypeScript strict checking
pnpm -r test         # Run all 129 tests
```

**Test the extension:** Open the monorepo in VS Code and press F5. A new window opens with the test workspace loaded.

**Release:**

```bash
pnpm release         # build + test + publish npm + package .vsix
```

## License

MIT
