/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#toolbar
 * @task: TASK-022
 * @validated: null
 * ---
 */

import { useState } from 'react';
import type { Database, DBView, Field } from 'sogo-db-core';
import type { SyncStatus } from '../protocol.js';
import { postCommand } from '../hooks/useVSCodeApi.js';
import { SortFilterPanel } from './SortFilterPanel.js';
import { GalleryViewSettingsPanel } from './gallery/GalleryViewSettingsPanel.js';

interface ToolbarProps {
	view: DBView;
	schema: Field[];
	database: Database;
	syncStatus: SyncStatus;
	onManageFields: () => void;
}

export function Toolbar({ view, schema, database, syncStatus, onManageFields }: ToolbarProps) {
	const [showSort, setShowSort] = useState(false);
	const [showFilter, setShowFilter] = useState(false);
	const [showViewSettings, setShowViewSettings] = useState(false);

	const sortCount = view.sort.length;
	const filterCount = view.filter.length;
	const hiddenCount = view.hiddenFields.length;
	const syncLabel =
		syncStatus.kind === 'syncing'
			? 'Syncing'
			: syncStatus.kind === 'synced'
				? 'Synced'
				: syncStatus.kind === 'failed'
					? 'Sync failed'
					: 'Local only';
	return (
		<>
			<span
				className={`db-sync-status ${
					syncStatus.kind === 'syncing'
						? 'db-sync-status--syncing'
						: syncStatus.kind === 'synced'
							? 'db-sync-status--synced'
							: syncStatus.kind === 'failed'
								? 'db-sync-status--error'
								: 'db-sync-status--disabled'
				}`}
				title={syncStatus.message || syncLabel}
			>
				{syncLabel}
			</span>
			<div className="relative">
				<button
					className={`db-btn ${filterCount > 0 ? 'db-btn-active' : ''}`}
					onClick={() => { setShowFilter(!showFilter); setShowSort(false); setShowViewSettings(false); }}
				>
					Filter{filterCount > 0 ? ` (${filterCount})` : ''}
				</button>
				{showFilter && (
					<SortFilterPanel
						mode="filter"
						view={view}
						schema={schema}
						onClose={() => setShowFilter(false)}
					/>
				)}
			</div>

			<div className="relative">
				<button
					className={`db-btn ${sortCount > 0 ? 'db-btn-active' : ''}`}
					onClick={() => { setShowSort(!showSort); setShowFilter(false); setShowViewSettings(false); }}
				>
					Sort{sortCount > 0 ? ` (${sortCount})` : ''}
				</button>
				{showSort && (
					<SortFilterPanel
						mode="sort"
						view={view}
						schema={schema}
						onClose={() => setShowSort(false)}
					/>
				)}
			</div>

			<div className="relative">
				<button
					className={`db-btn ${hiddenCount > 0 ? 'db-btn-active' : ''}`}
					onClick={() => {
						setShowSort(false);
						setShowFilter(false);
						setShowViewSettings(false);
						onManageFields();
					}}
				>
					Fields{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
				</button>
			</div>

			{view.type === 'gallery' && (
				<div className="relative">
					<button
						className={`db-btn ${view.cardCoverField ? 'db-btn-active' : ''}`}
						onClick={() => { setShowViewSettings(!showViewSettings); setShowSort(false); setShowFilter(false); }}
					>
						View
					</button>
					{showViewSettings && (
						<GalleryViewSettingsPanel
							view={view}
							database={database}
							onClose={() => setShowViewSettings(false)}
						/>
					)}
					</div>
				)}
			<button className="db-btn db-btn-primary" onClick={() => postCommand({ type: 'create-record' })}>
				+ Record
			</button>
		</>
	);
}
