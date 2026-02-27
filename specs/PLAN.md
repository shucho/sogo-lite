# Sogo Database Feature: Fork vs Extension vs MCP Analysis

> **Research Date:** 2026-02-27
> **Context:** Evaluating whether the Notion-style database feature built into the Sogo VS Code fork can be extracted into a portable extension + MCP server, making it editor-agnostic and maintainable without carrying a full VS Code fork.

---

## TL;DR Recommendation

**Build two things:**

1. **`sogo-db` VS Code extension** — Webview-based (React + TanStack Table), renders `.db.json` files as tables/kanbans/calendars/galleries. Uses `CustomEditorProvider` for editor tabs + `WebviewViewProvider` for sidebar. Flat `.db.json` files remain the source of truth. No external dependencies.

2. **`sogo-mcp-server` npm package** — Standalone MCP server that reads/writes the same `.db.json` files. Gives Claude Code, Cursor, Windsurf, and VS Code Copilot structured CRUD access with field-name resolution, search, and pagination. Ships as an npm package, configured in `.mcp.json`.

This replaces ~9,700 lines of fork code with a portable, maintainable extension that works in VS Code, Cursor, Windsurf, and any editor supporting the extension API. The MCP server makes the data accessible to any AI agent on any editor.

**Skip NocoDB/Baserow/etc.** — The `.db.json` format is simpler, faster, git-friendly, and has zero dependencies. These tools solve problems (multi-user, advanced queries, web UI) that aren't relevant here.

---

## Table of Contents

1. [What the Fork Currently Does](#1-what-the-fork-currently-does)
2. [Can This Be an Extension?](#2-can-this-be-an-extension)
3. [External Database Backends Evaluated](#3-external-database-backends-evaluated)
4. [MCP Server for AI Agent Access](#4-mcp-server-for-ai-agent-access)
5. [Recommended Architecture](#5-recommended-architecture)
6. [Implementation Plan](#6-implementation-plan)
7. [Open Questions](#7-open-questions)

---

## 1. What the Fork Currently Does

### Code Volume
**9,693 lines of TypeScript** across 18 files in `src/vs/workbench/contrib/database/`.

| Component | Lines | Purpose |
|-----------|-------|---------|
| recordEditor.ts | 1,931 | Record detail panel with 15+ field type editors |
| databaseStyles.ts | 1,803 | CSS-in-JS (all styling) |
| tableView.ts | 1,062 | Table grid with inline editing |
| databaseViewPane.ts | 949 | Sidebar two-panel layout |
| databaseEditor.ts | 875 | Full editor pane with file watching |
| databaseService.ts | 564 | File I/O, scanning, relation sync |
| database.ts | 549 | Data model, formulas, rollups, utilities |
| sortFilterPanel.ts | 353 | Sort and filter UI |
| schemaEditor.ts | 315 | Field management modal |
| galleryView.ts | 238 | Card/gallery view |
| databaseSync.ts | 200 | Supabase sync (optional) |
| kanbanView.ts | 199 | Kanban board |
| fieldsPicker.ts | 145 | Field visibility/ordering |
| calendarView.ts | 116 | Month calendar view |
| database.contribution.ts | 112 | Registration and config |
| listView.ts | 98 | Compact list view |
| overlayHost.ts | 96 | Theme-aware overlay positioning |
| databaseEditorInput.ts | 88 | Editor input serialization |

### Rendering Approach
**Pure DOM manipulation** — no frameworks. Uses VS Code's internal `dom.js` utilities (`$`, `append`, `clearNode`). Every view (table, kanban, calendar, gallery, list) and every editor (record, schema, sort/filter) is hand-built DOM. This is the primary source of complexity and the strongest argument for extraction.

### Internal API Dependencies

| Dependency | Extension API Equivalent | Gap? |
|-----------|--------------------------|------|
| IFileService | `vscode.workspace.fs` | No |
| IWorkspaceContextService | `vscode.workspace` | No |
| IConfigurationService | `vscode.workspace.getConfiguration()` | No |
| IStorageService | `context.globalState` / `workspaceState` | No |
| INotificationService | `vscode.window.showInformationMessage()` | No |
| IThemeService | `vscode.window.activeColorTheme` | No |
| IEditorService | `vscode.window.showTextDocument()` | Minor gap |
| IPathService | **None** — use `os.homedir()` in extension host | Workaround exists |
| IEditorPaneRegistry | `CustomEditorProvider` in extension API | No |
| IViewContainersRegistry | `contributes.viewsContainers` in package.json | No |
| IViewsRegistry | `contributes.views` in package.json | No |
| IInstantiationService | Manual construction | Pattern change only |

**Verdict: Nothing in the fork requires internal-only APIs.** Every capability has an extension API equivalent or a simple workaround.

---

## 2. Can This Be an Extension?

### Yes. Here's how each piece maps:

| Fork Feature | Extension Approach |
|-------------|-------------------|
| Sidebar database list | `TreeDataProvider` (native tree view) |
| Sidebar database content | `WebviewViewProvider` (sidebar webview) |
| Full editor for .db.json | `CustomEditorProvider` (webview in editor tab) |
| Table/kanban/calendar/gallery/list | React components in webview |
| Record editor | React form in webview |
| Schema editor | React modal in webview |
| Sort/filter panel | React popover in webview |
| File watching | `vscode.workspace.createFileSystemWatcher()` with `RelativePattern` |
| Global databases (~/.sogo/) | `os.homedir()` + `RelativePattern` for watching outside workspace |
| Configuration setting | `contributes.configuration` in package.json |
| Supabase sync | Direct `fetch()` from extension host |

### What Gets Better as an Extension

1. **Modern UI frameworks** — React + TanStack Table + Tailwind instead of 3,800 lines of manual DOM + CSS-in-JS
2. **Virtual scrolling** — TanStack Table virtualizes rows natively; current fork renders all rows
3. **Component reuse** — Cell editors shared between table view and record editor
4. **Ecosystem libraries** — react-big-calendar, dnd-kit, date-fns instead of custom implementations
5. **Maintainability** — Declarative React vs imperative DOM; easier to add features
6. **Hot reload** — Extension development has fast iteration with esbuild
7. **Distribution** — VS Code Marketplace + OpenVSX (for Cursor/Windsurf)
8. **No fork maintenance** — No rebasing on every VS Code release

### What Gets Slightly Worse

1. **Memory** — Each webview is ~30-80 MB; sidebar + editor = ~60-160 MB
2. **Startup** — Webview needs to load React bundle (~200ms)
3. **Message passing** — Extension host <-> webview communication is async postMessage
4. **File watching outside workspace** — Must use `RelativePattern(Uri.file(...))` pattern

These are minor, well-understood tradeoffs.

### Existing Precedent

**Portable Kanban** extension uses exactly this pattern: `CustomEditorProvider` + React + Jotai + webpack, rendering `.kanban` files as interactive boards. It proves the approach works in production.

**No existing extension provides a Notion-style database experience.** This would be the first.

---

## 3. External Database Backends Evaluated

We evaluated NocoDB, AppFlowy, AnyType, Baserow, Teable, and Huly as potential backends.

### Verdict: Not worth it.

| Tool | Local? | Weight | API | License | Score |
|------|--------|--------|-----|---------|-------|
| **NocoDB** | Single binary + SQLite | 28 MB + 256 MB RAM | Excellent REST | Sustainable Use (not OSI) | 9/10 |
| **Baserow** | Docker + PostgreSQL | Heavy | Excellent REST + embedded MCP | MIT | 6/10 |
| **AnyType** | 900 MB Electron app | Very heavy | Local HTTP, 1 req/sec limit | Custom (not OSI) | 4/10 |
| **Teable** | Docker + PostgreSQL | Heavy | REST (Swagger issues) | AGPL | 3/10 |
| **AppFlowy** | No headless mode | Heavy | Cloud-only API | AGPL | 2/10 |
| **Huly** | Docker + CockroachDB + ES + MinIO | Enterprise-grade | WebSocket + REST | EPL-2.0 | 1/10 |

### Why `.db.json` beats all of them for this use case

- **Zero dependencies** — no process to spawn, no port to manage
- **File watching** — IDE picks up changes via native FS events
- **Git-friendly** — JSON diffs are readable; can version control your databases
- **Direct AI access** — Claude Code reads/writes JSON files already; no API layer needed
- **Instant startup** — no server boot time
- **Simple** — one file = one database; inspect with any text editor

NocoDB would only make sense if you needed: multi-user concurrent access, 100K+ row datasets, SQL queries, or webhooks. Those aren't requirements here.

---

## 4. MCP Server for AI Agent Access

### Why build an MCP server at all?

Claude Code can already read `.db.json` files. But an MCP server adds:

| Capability | Raw file access | With MCP server |
|-----------|----------------|-----------------|
| Read database | Must parse full JSON | Paginated, filtered results |
| Create record | Must read + modify + write full file | Single tool call with field names |
| Search across databases | Read every file | Single `search_records` call |
| Field name resolution | Must map field names to UUIDs | Automatic |
| Schema validation | None | Prevents malformed writes |
| Context window efficiency | Full JSON in context | Only relevant records |
| Works with Cursor/Windsurf | Only if they read files | Yes, via MCP |

### MCP Server Design

**7 core tools:**
```
list_databases       — List all databases (global + workspace) with schemas
get_database_schema  — Get field definitions for a database
list_records         — Paginated records with optional filter/sort
create_record        — Create record using field names (not IDs)
update_record        — Update specific fields by name
delete_record        — Delete a record
search_records       — Full-text search across all databases
```

**Resources (browsable context):**
```
sogo://databases                              — All databases
sogo://databases/{id}                         — Single database schema + summary
sogo://databases/{id}/records                 — All records
sogo://databases/{id}/records/{recordId}      — Single record
```

**Configuration (`.mcp.json` at project root):**
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

This works with Claude Code, Cursor, Windsurf, and VS Code Copilot.

---

## 5. Recommended Architecture

```
┌──────────────────────────────────────────────────────┐
│                    .db.json files                      │
│         (source of truth — flat JSON on disk)          │
│                                                        │
│   ~/.sogo/globalDatabases/   +   ./workspace/*.db.json │
└──────────┬──────────────────────────────┬──────────────┘
           │                              │
           │  file watching               │  file read/write
           │                              │
┌──────────▼──────────────┐    ┌──────────▼──────────────┐
│   sogo-db Extension      │    │   sogo-mcp-server        │
│                          │    │                          │
│  Extension Host:         │    │  Standalone npm package   │
│  - File scanning         │    │  - stdio transport        │
│  - File watching         │    │  - CRUD tools             │
│  - CRUD operations       │    │  - Resources              │
│  - Global path config    │    │  - Field name resolution  │
│                          │    │  - Search                 │
│  Webview (React):        │    │                          │
│  - Table (TanStack)      │    │  Works with:             │
│  - Kanban (dnd-kit)      │    │  - Claude Code           │
│  - Calendar              │    │  - Cursor                │
│  - Gallery               │    │  - Windsurf              │
│  - List                  │    │  - VS Code Copilot       │
│  - Record editor         │    │                          │
│  - Schema editor         │    │                          │
│                          │    │                          │
│  Sidebar:                │    │                          │
│  - TreeView (DB list)    │    │                          │
│  - WebviewView (preview) │    │                          │
└──────────────────────────┘    └──────────────────────────┘
```

### Key design decisions

1. **`.db.json` stays as the format** — no migration to SQLite, NocoDB, or anything else
2. **Extension and MCP server share no runtime** — both read/write the same files independently
3. **File system is the coordination mechanism** — extension watches for changes; MCP server reads on demand
4. **Two npm packages** — `sogo-db` (extension) and `sogo-mcp-server` (MCP server), can share a `sogo-db-core` library for the data model
5. **React + TanStack Table** for the webview UI — replaces 3,800+ lines of manual DOM + CSS

### Shared core library (`sogo-db-core`)

Extract from the fork's `database.ts`:
- Type definitions (`Database`, `Field`, `DBRecord`, `DBView`, `DatabaseScope`)
- Utility functions (`getRecordTitle`, `getFieldValue`, `getFieldDisplayValue`)
- Formula engine (`computeFormulaValue`, `evaluateFormulaToken`)
- Rollup computation (`computeRollupValue`)
- Sort/filter logic (`applySorts`, `applyFilters`)
- Relation inference (`inferImplicitRelationTargets`)
- Schema migration (`migrateSchema` equivalent)

This is ~550 lines that both the extension and MCP server import.

---

## 6. Implementation Plan

### Phase 1: Core library + MCP server (fastest value)

**Goal:** Get Claude Code reading/writing databases with structured tools.

1. Create `sogo-mcp-server` npm package
2. Extract `sogo-db-core` with types + utilities from fork
3. Implement 7 MCP tools (list, schema, CRUD, search)
4. Add `.mcp.json` template to repos
5. Test with Claude Code

**Effort:** ~2-3 sessions. The MCP SDK makes this straightforward.

### Phase 2: VS Code extension scaffold

**Goal:** Basic extension that opens `.db.json` files with a webview.

1. Scaffold extension with `yo code`
2. Register `CustomEditorProvider` for `*.db.json`
3. Set up React + esbuild + Tailwind in webview
4. Implement table view with TanStack Table
5. Extension host handles file I/O and scanning
6. Sidebar TreeView for database list

**Effort:** ~3-4 sessions.

### Phase 3: Full view parity

**Goal:** Match all 5 views from the fork.

1. Kanban view (dnd-kit for drag-and-drop)
2. Calendar view (simple month grid, no library needed)
3. Gallery view (CSS grid + card components)
4. List view (compact rows)
5. Record editor (form with all field types)
6. Schema editor (field CRUD modal)
7. Sort/filter panel

**Effort:** ~4-5 sessions.

### Phase 4: Global databases + polish

**Goal:** Full feature parity with the fork.

1. Global database scanning (`~/.sogo/globalDatabases/`)
2. `database.globalPaths` configuration
3. Global/Workspace grouping in sidebar
4. Create/delete/duplicate/move databases
5. CSV import/export
6. Relation backlink sync
7. Optional Supabase sync

**Effort:** ~2-3 sessions.

### Phase 5: Distribution

1. Publish to VS Code Marketplace
2. Publish to OpenVSX (for Cursor/Windsurf)
3. Publish `sogo-mcp-server` to npm
4. Write CLAUDE.md / copilot-instructions integration docs

---

## 7. Open Questions

1. **Repo structure** — Monorepo with `packages/core`, `packages/extension`, `packages/mcp-server`? Or separate repos?

2. **React vs Svelte** — React has more ecosystem (TanStack, dnd-kit, shadcn/ui). Svelte is lighter and faster. Both work in webviews. The Portable Kanban extension uses React successfully.

3. **Extension name** — `sogo-db`? `notion-db`? `ide-database`? Something that doesn't tie to the fork brand?

4. **Supabase sync** — Keep it? Drop it? Make it a separate extension?

5. **Formula engine** — The fork has a basic formula engine (~200 lines). Keep it or drop it for MVP?

6. **Field types** — The fork supports 15+ types. MVP could start with: text, number, select, multiselect, status, date, checkbox, url, relation.

---

## Sources

### VS Code Extension API
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview)
- [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)
- [TreeView API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [WebviewView API](https://code.visualstudio.com/api/references/vscode-api#WebviewViewProvider)
- [FileSystemWatcher](https://code.visualstudio.com/api/references/vscode-api#FileSystemWatcher)

### MCP
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code MCP Configuration](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Notion MCP Server (official)](https://github.com/makenotion/notion-mcp-server)
- [NocoDB MCP Server](https://github.com/andrewlwn77/nocodb-mcp)
- [Baserow embedded MCP](https://baserow.io/user-docs/mcp-server)

### Self-Hosted Databases
- [NocoDB](https://github.com/nocodb/nocodb) — 62K stars, single binary + SQLite, REST API
- [Baserow](https://github.com/baserow/baserow) — 4K stars, Docker + PostgreSQL, MIT license
- [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) — 68K stars, Flutter + Rust, no headless API
- [AnyType](https://github.com/anyproto/anytype-ts) — 7K stars, Electron, local API with rate limits
- [Teable](https://github.com/teableio/teable) — 21K stars, Docker + PostgreSQL
- [Huly](https://github.com/hcengineering/platform) — 25K stars, enterprise infrastructure

### Precedent Extensions
- [Portable Kanban](https://marketplace.visualstudio.com/items?itemName=nickmillerdev.vscode-kanban) — CustomEditorProvider + React + .kanban files
- [Edit CSV](https://marketplace.visualstudio.com/items?itemName=janisdd.vscode-edit-csv) — CustomTextEditorProvider for CSV grid editing
