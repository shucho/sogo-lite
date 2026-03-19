/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#view-switcher
 * @task: TASK-022
 * @validated: null
 * ---
 */

import { useEffect, useRef, useState } from 'react';
import type { DBView, ViewType } from 'sogo-db-core';
import { postCommand } from '../hooks/useVSCodeApi.js';

const VIEW_ICONS: Record<ViewType, string> = {
	table: '\u25A6',    // ▦
	kanban: '\u25A4',   // ▤
	list: '\u2630',     // ☰
	gallery: '\u229E',  // ⊞
	calendar: '\u{1F5D3}', // 🗓
};

const VIEW_DEFAULT_NAMES: Record<ViewType, string> = {
	table: 'Table',
	kanban: 'Kanban',
	list: 'List',
	gallery: 'Gallery',
	calendar: 'Calendar',
};

interface ViewSwitcherProps {
	views: DBView[];
	activeViewId: string;
}

export function ViewSwitcher({ views, activeViewId }: ViewSwitcherProps) {
	const [showMenu, setShowMenu] = useState(false);
	const [editingViewId, setEditingViewId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState('');
	const menuRef = useRef<HTMLDivElement>(null);
	const addBtnRef = useRef<HTMLButtonElement>(null);

	function handleAdd(viewType: ViewType) {
		postCommand({
			type: 'create-view',
			name: VIEW_DEFAULT_NAMES[viewType],
			viewType,
		});
		setShowMenu(false);
	}

	function startRename(view: DBView) {
		setEditingViewId(view.id);
		setRenameDraft(view.name);
	}

	function commitRename(view: DBView) {
		const nextName = renameDraft.trim();
		setEditingViewId(null);
		if (!nextName || nextName === view.name) return;
		postCommand({ type: 'update-view', viewId: view.id, changes: { name: nextName } });
	}

	useEffect(() => {
		if (!showMenu) return;
		function handleOutsideClick(e: MouseEvent) {
			const target = e.target as Node;
			if (
				menuRef.current &&
				!menuRef.current.contains(target) &&
				addBtnRef.current &&
				!addBtnRef.current.contains(target)
			) {
				setShowMenu(false);
			}
		}
		document.addEventListener('mousedown', handleOutsideClick);
		return () => document.removeEventListener('mousedown', handleOutsideClick);
	}, [showMenu]);

	return (
		<div className="db-tabs">
			{views.map((view) => (
				<div key={view.id} className="db-tab-wrapper">
					{editingViewId === view.id ? (
						<input
							autoFocus
							className="db-input db-tab-rename-input"
							value={renameDraft}
							onChange={(e) => setRenameDraft(e.target.value)}
							onBlur={() => commitRename(view)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									commitRename(view);
								}
								if (e.key === 'Escape') {
									e.preventDefault();
									setEditingViewId(null);
								}
							}}
						/>
					) : (
						<button
							type="button"
							className={`db-tab ${view.id === activeViewId ? 'db-tab--active' : ''}`}
							onClick={(e) => {
								e.preventDefault();
								postCommand({ type: 'switch-view', viewId: view.id });
							}}
							onDoubleClick={(e) => {
								e.stopPropagation();
								startRename(view);
							}}
							title={view.name}
						>
							{VIEW_ICONS[view.type] ?? ''} {view.name}
						</button>
					)}
					{views.length > 1 && editingViewId !== view.id && (
						<button
							type="button"
							className="db-tab-close"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								postCommand({ type: 'delete-view', viewId: view.id });
							}}
							title="Delete view"
						>
							×
						</button>
					)}
					</div>
				))}
				<div className="relative">
					<button
						ref={addBtnRef}
						type="button"
						className="db-add-view-btn"
						onClick={(e) => {
							e.preventDefault();
							setShowMenu((v) => !v);
						}}
						title="Add view"
					>
						+
					</button>
					{showMenu && (
						<div
							ref={menuRef}
							className="db-context-menu absolute top-full left-0 z-50"
						>
							{(['table', 'kanban', 'list', 'gallery', 'calendar'] as ViewType[]).map((vt) => (
								<button
									key={vt}
									type="button"
									className="db-context-menu-item block w-full text-left"
									onClick={() => handleAdd(vt)}
								>
									{VIEW_ICONS[vt]} {VIEW_DEFAULT_NAMES[vt]}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
	);
}
