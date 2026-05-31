export interface GateResult {
  ok: boolean;
  nodeType: string;
  nodeName: string;
  isComponentSet: boolean;
  defaultVariantId?: string;
  reason?: string;
}

// Figma MCP metadata XML encodes node type as the element's tag name
// (e.g. <frame>, <symbol>) rather than a type="..." attribute. Map the tag
// names we accept to the canonical type strings used elsewhere.
const TAG_TO_TYPE: Record<string, string> = {
  frame: 'FRAME',
  group: 'GROUP',
  instance: 'INSTANCE',
  component: 'COMPONENT',
  symbol: 'COMPONENT',
  componentset: 'COMPONENT_SET',
  component_set: 'COMPONENT_SET',
  'component-set': 'COMPONENT_SET',
};

const ROOT_TAG = new RegExp(
  `<(${Object.keys(TAG_TO_TYPE).join('|')})\\b[^>]*>`,
  'i',
);
const ATTR = (name: string) => new RegExp(`${name}="([^"]+)"`, 'i');

// Strict presentational gate: only accept node types we know can render
// as a self-contained component. Anything else (PAGE, SECTION, DOCUMENT) is
// surfaced as needs_context, per v1 design.
export function gatePresentational(metadataXml: string): GateResult {
  const rootMatch = metadataXml.match(ROOT_TAG);
  if (!rootMatch) {
    return {
      ok: false,
      nodeType: 'unknown',
      nodeName: '',
      isComponentSet: false,
      reason:
        'This points to a non-presentational node. Cosign v1 only renders frames, components, instances, or groups.',
    };
  }

  const rootBlock = metadataXml.slice(rootMatch.index ?? 0, (rootMatch.index ?? 0) + 600);
  const nameAttr = rootBlock.match(ATTR('name'))?.[1] ?? '';
  const nodeType = TAG_TO_TYPE[rootMatch[1].toLowerCase()];

  if (!nodeType) {
    return {
      ok: false,
      nodeType: rootMatch[1].toUpperCase(),
      nodeName: nameAttr,
      isComponentSet: false,
      reason: `This points to a ${rootMatch[1].toLowerCase()} node. Cosign v1 only renders presentational components — frames, components, instances, or groups.`,
    };
  }

  if (nodeType === 'COMPONENT_SET') {
    const childMatch = metadataXml.match(
      /<(?:component|symbol)\b[^>]*\bid="([^"]+)"/i,
    );
    return {
      ok: true,
      nodeType,
      nodeName: nameAttr,
      isComponentSet: true,
      defaultVariantId: childMatch?.[1],
    };
  }

  return { ok: true, nodeType, nodeName: nameAttr, isComponentSet: false };
}
