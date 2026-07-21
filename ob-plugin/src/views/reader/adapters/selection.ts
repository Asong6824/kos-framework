import { readerSelectionFromText } from '../../../reader/model';
import type { ReaderSelection } from '../../../reader/model';

function containsNode(container: HTMLElement, node: Node | null): boolean {
  if (!node) return false;
  return node === container || container.contains(node.nodeType === 3 ? node.parentNode : node);
}

export function selectionWithin(
  container: HTMLElement,
  location: string,
  positionLabel: string,
): ReaderSelection | null {
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!containsNode(container, range.commonAncestorContainer)) return null;
  return readerSelectionFromText(selection.toString(), location, positionLabel);
}
