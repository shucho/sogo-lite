/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#fields-picker
 * @task: TASK-026
 * @validated: null
 * ---
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DBView, Field } from 'sogo-db-core';
import { postCommand } from '../hooks/useVSCodeApi.js';

interface FieldsPickerProps {
	view: DBView;
	schema: Field[];
	onManageFields: () => void;
	onClose: () => void;
}

export function FieldsPicker({ view, schema, onManageFields, onClose }: FieldsPickerProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [dragSourceId, setDragSourceId] = useState<string | null>(null);
	const [order, setOrder] = useState<string[]>(() => {
		const base = view.fieldOrder?.length ? [...view.fieldOrder] : schema.map((field) => field.id);
		for (const field of schema) {
			if (!base.includes(field.id)) base.push(field.id);
		}
		return base;
	});
	const [hidden, setHidden] = useState<Set<string>>(() => new Set(view.hiddenFields ?? []));

	useEffect(() => {
		const base = view.fieldOrder?.length ? [...view.fieldOrder] : schema.map((field) => field.id);
		for (const field of schema) {
			if (!base.includes(field.id)) base.push(field.id);
		}
		setOrder(base);
		setHidden(new Set(view.hiddenFields ?? []));
	}, [view.fieldOrder, view.hiddenFields, schema]);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [onClose]);

	const fieldById = useMemo(() => new Map(schema.map((field) => [field.id, field])), [schema]);

	function flush(nextOrder: string[], nextHidden: Set<string>) {
		postCommand({
			type: 'update-view',
			viewId: view.id,
			changes: {
				fieldOrder: nextOrder,
				hiddenFields: [...nextHidden],
			},
		});
	}

	function toggleField(fieldId: string, visible: boolean) {
		setHidden((prev) => {
			const next = new Set(prev);
			if (visible) next.delete(fieldId);
			else next.add(fieldId);
			flush(order, next);
			return next;
		});
	}

	function hideAll() {
		const next = new Set(schema.map((field) => field.id));
		setHidden(next);
		flush(order, next);
	}

	function showAll() {
		const next = new Set<string>();
		setHidden(next);
		flush(order, next);
	}

	function reorder(targetId: string) {
		if (!dragSourceId || dragSourceId === targetId) return;
		setOrder((prev) => {
			const next = [...prev];
			const src = next.indexOf(dragSourceId);
			const dst = next.indexOf(targetId);
			if (src < 0 || dst < 0) return prev;
			next.splice(src, 1);
			next.splice(dst, 0, dragSourceId);
			flush(next, hidden);
			return next;
		});
	}

	return (
		<div
			ref={panelRef}
			className="db-dropdown-panel db-fields-panel absolute right-0 top-full z-50 mt-1"
			style={{ minWidth: 240 }}
		>
			<div className="db-panel-section-title">Fields</div>
			<div className="db-fields-list max-h-[260px] overflow-y-auto pr-1">
				{order.map((fieldId) => {
					const field = fieldById.get(fieldId);
					if (!field) return null;
					return (
						<div
							key={field.id}
							className="db-fields-row"
							draggable
							onDragStart={() => setDragSourceId(field.id)}
							onDragEnd={() => setDragSourceId(null)}
							onDragOver={(e) => e.preventDefault()}
							onDrop={(e) => {
								e.preventDefault();
								reorder(field.id);
								setDragSourceId(null);
							}}
						>
							<span className="db-fields-handle select-none">⠿</span>
							<input
								type="checkbox"
								checked={!hidden.has(field.id)}
								onChange={(e) => toggleField(field.id, e.target.checked)}
							/>
							<span className="db-fields-name truncate">{field.name}</span>
						</div>
					);
				})}
			</div>
			<div className="db-panel-add flex items-center gap-2">
				<button className="db-btn" onClick={hideAll}>Hide all</button>
				<button className="db-btn" onClick={showAll}>Show all</button>
				<button
					className="db-btn ml-auto"
					onClick={() => {
						onClose();
						onManageFields();
					}}
				>
					Manage fields...
				</button>
			</div>
		</div>
	);
}
