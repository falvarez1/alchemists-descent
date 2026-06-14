import type { DocIssue, ValidationRepairActionId } from '@/builder/validate';

export interface ValidationRepairAction {
  id: ValidationRepairActionId;
  label: string;
  mutatesDocument: boolean;
}

const ACTIONS: Record<ValidationRepairActionId, ValidationRepairAction> = {
  addSpawnAtCamera: { id: 'addSpawnAtCamera', label: 'Add Spawn At Camera', mutatesDocument: true },
  moveSpawnToCamera: { id: 'moveSpawnToCamera', label: 'Move Spawn To Camera', mutatesDocument: true },
  markPortalAlwaysOpen: { id: 'markPortalAlwaysOpen', label: 'Mark Portal Always Open', mutatesDocument: true },
  createGoldenKeyNearCamera: { id: 'createGoldenKeyNearCamera', label: 'Create Key Near Camera', mutatesDocument: true },
  selectIssueTarget: { id: 'selectIssueTarget', label: 'Select Target', mutatesDocument: false },
  removeDeadLink: { id: 'removeDeadLink', label: 'Remove Link', mutatesDocument: true },
  showValidationOverlay: { id: 'showValidationOverlay', label: 'Show Overlay', mutatesDocument: false },
  showClearanceOverlay: { id: 'showClearanceOverlay', label: 'Show Clearance', mutatesDocument: false },
  previewCarveCorridor: { id: 'previewCarveCorridor', label: 'Preview Corridor', mutatesDocument: false },
};

export function validationRepairActions(issue: DocIssue): ValidationRepairAction[] {
  return (issue.actions ?? [])
    .map((id) => ACTIONS[id])
    .filter((action): action is ValidationRepairAction => action !== undefined);
}
