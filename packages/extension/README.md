# Sogo Lite

Sogo Lite turns `.db.json` files into editable databases inside VS Code.

You can use it to manage tasks, projects, CRM records, content plans, or any other structured data without leaving your editor.

## What You Get

- Table, Kanban, Calendar, Gallery, and List views
- Inline editing for records and properties
- A Databases sidebar for browsing workspace and global databases
- Schema editing for fields, views, and property settings
- CSV import/export
- Local file-based storage with no server required

## Install

### From the Marketplace

Search for `Sogo Lite` in the VS Code Extensions panel.

### From a VSIX

In VS Code:

1. Open the Extensions view
2. Click the `...` menu
3. Choose `Install from VSIX...`
4. Select the `.vsix` file

If you are repeatedly testing a local build, the most reliable install command is:

```bash
code --install-extension /path/to/sogo-lite-x.y.z.vsix --force
```

## Getting Started

### Option 1: Create a new database

1. Open a folder in VS Code
2. Run `Sogo DB: Create Database` from the Command Palette
3. Enter a name
4. Open the generated `.db.json` file

The file opens in the custom Sogo Lite editor automatically.

### Option 2: Open an existing database

If you already have a `.db.json` file in your workspace, open it in VS Code. Sogo Lite will render it as a database editor instead of raw JSON.

## How To Use

### Databases Sidebar

Open the `Databases` activity bar view to:

- browse workspace databases
- browse global databases
- create databases
- rename databases
- open a database file
- duplicate, import, export, or delete a database

### Editor Basics

When a database is open:

- click a cell to edit it
- click a checkbox to toggle it
- click a record row action to open the record detail panel
- use the view tabs to switch between Table, Kanban, Calendar, Gallery, and List
- use the toolbar to sort, filter, manage fields, and change view settings

### Views

- `Table`: spreadsheet-style editing, column resize, field controls
- `Kanban`: drag records between status/select groups
- `Calendar`: view records by date
- `Gallery`: card-based browsing
- `List`: compact property-focused layout

Each view stores its own settings such as hidden fields, grouping, sort, and filter.

### Record Details

Open a record to:

- edit all properties in one place
- update notes/body content
- manage relation fields
- pin important properties into the record header

### Schema and Properties

Use `Manage fields` to:

- add new fields
- rename fields
- change field types
- configure select/status options
- control which properties appear in each view

## Database Files

A Sogo Lite database is a normal `.db.json` file stored in your filesystem.

That means:

- databases work well with Git
- external edits are picked up by the extension
- there is no separate service to run

## Optional: MCP Server

If you want AI tools to read and write the same databases, run the companion MCP server:

```bash
npx sogo-mcp-server
```

This is optional. The extension works without it.

## Troubleshooting

### A local VSIX install does not seem to update

If you are reinstalling the same extension locally, use:

```bash
code --install-extension /path/to/sogo-lite-x.y.z.vsix --force
```

### A `.db.json` file opens as plain JSON

Right-click the file and choose `Reopen With...`, then select `Sogo Database Editor`.
