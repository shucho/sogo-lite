/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#shared-components
 * @task: TASK-039
 * @validated: null
 * ---
 *
 * Notion-style dropdown for selecting options (status, select, multiselect).
 * Renders via portal to avoid overflow clipping in scrollable containers.
 * Anchors to a trigger element and positions below (or above if near bottom).
 */

import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getReadableTextColor } from 'sogo-db-core';

interface PickerDropdownProps {
	anchor: HTMLElement;
	options: readonly string[];
	selected: string[];
	multi?: boolean;
	groupStatus?: boolean;
	getColor: (opt: string) => string;
	onToggle: (option: string) => void;
	onClear?: () => void;
	onDone?: () => void;
	onClose: () => void;
}

type StatusSection = 'To-do' | 'In progress' | 'Complete';

function getStatusSection(label: string): StatusSection {
	const normalized = label.trim().toLowerCase();
	if (normalized.includes('done') || normalized.includes('complete')) {
		return 'Complete';
	}
	if (
		normalized.includes('progress') ||
		normalized.includes('active') ||
		normalized.includes('doing') ||
		normalized.includes('diagnostic')
	) {
		return 'In progress';
	}
	return 'To-do';
}

export function PickerDropdown({
	anchor,
	options,
	selected,
	multi,
	groupStatus,
	getColor,
	onToggle,
	onClear,
	onDone,
	onClose,
}: PickerDropdownProps) {
	const ref = useRef<HTMLDivElement>(null);

	// Close on click outside (ignore clicks on the anchor itself)
	useEffect(() => {
		function handleMouseDown(e: MouseEvent) {
			if (
				ref.current &&
				!ref.current.contains(e.target as Node) &&
				!anchor.contains(e.target as Node)
			) {
				onClose();
			}
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		document.addEventListener('mousedown', handleMouseDown);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handleMouseDown);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [onClose, anchor]);

	// Compute position from anchor bounding rect
	const rect = anchor.getBoundingClientRect();
	const width = Math.max(rect.width, 220);
	const left = Math.min(rect.left, window.innerWidth - width - 8);
	const spaceBelow = window.innerHeight - rect.bottom - 8;
	const spaceAbove = rect.top - 8;
	const above = spaceBelow < 150 && spaceAbove > spaceBelow;

	const style: React.CSSProperties = {
		position: 'fixed',
		left,
		width,
		maxWidth: 340,
		maxHeight: Math.min(320, above ? spaceAbove : spaceBelow),
		overflow: 'hidden',
		zIndex: 120,
	};

	if (above) {
		style.bottom = window.innerHeight - rect.top + 4;
	} else {
		style.top = rect.bottom + 4;
	}

	const groupedOptions = useMemo(() => {
		if (!groupStatus) {
			return [{ section: '', items: options }];
		}
		const buckets: Record<StatusSection, string[]> = {
			'To-do': [],
			'In progress': [],
			Complete: [],
		};
		for (const option of options) {
			buckets[getStatusSection(option)].push(option);
		}
		return (['To-do', 'In progress', 'Complete'] as const)
			.filter((section) => buckets[section].length > 0)
			.map((section) => ({ section, items: buckets[section] }));
	}, [groupStatus, options]);

	return createPortal(
		<div ref={ref} className="db-dropdown-panel db-record-picker-panel" style={style}>
			{selected.length > 0 && (
				<div className="db-record-picker-selected">
					{selected.map((option) => (
						<button
							key={option}
							type="button"
							className="db-record-picker-selected-chip"
							onClick={() => onToggle(option)}
						>
							<span
								className="db-record-picker-selected-chip-label"
								style={{
									backgroundColor: getColor(option),
									color: getReadableTextColor(getColor(option)),
								}}
							>
								{option}
								<span className="db-record-picker-selected-chip-remove">×</span>
							</span>
						</button>
					))}
				</div>
			)}

			<div className="db-record-picker-list">
				{groupedOptions.length === 0 || options.length === 0 ? (
					<div className="db-panel-empty">No matches</div>
				) : groupedOptions.map(({ section, items }) => (
					<div key={section || 'default'}>
						{section ? <div className="db-record-picker-section-title">{section}</div> : null}
						{items.map((option) => {
							const isSelected = selected.includes(option);
							const color = getColor(option);
							return (
								<button
									key={option}
									type="button"
									className="db-record-picker-item"
									onClick={() => onToggle(option)}
								>
									<span
										className="db-record-picker-label db-record-picker-label--color"
										style={{
											backgroundColor: color,
											color: getReadableTextColor(color),
										}}
									>
										{option}
									</span>
									<span className="db-record-picker-mark">{isSelected ? '✓' : ''}</span>
								</button>
							);
						})}
					</div>
				))}
			</div>

			{(multi || onClear) && (
				<div className="db-panel-add flex items-center justify-end gap-2">
					{onClear && (
						<button type="button" className="db-btn" onClick={onClear}>
							Clear
						</button>
					)}
					{multi && (
						<button type="button" className="db-btn db-btn-primary" onClick={() => (onDone ? onDone() : onClose())}>
							Done
						</button>
					)}
				</div>
			)}
		</div>,
		document.body,
	);
}
