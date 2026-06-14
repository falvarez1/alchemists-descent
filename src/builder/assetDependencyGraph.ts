import type { AssetRecord } from '@/builder/assets/AssetTypes';

export interface AssetGraphNode {
  id: string;
  label: string;
  kind: string;
  origin: string;
  missing: boolean;
}

export interface AssetGraphEdge {
  from: string;
  to: string;
  label: string;
  missing: boolean;
}

export interface AssetDependencyGraph {
  nodes: AssetGraphNode[];
  edges: AssetGraphEdge[];
}

export function buildAssetDependencyGraph(records: readonly AssetRecord[]): AssetDependencyGraph {
  const nodes = records.map((record) => ({
    id: record.assetId,
    label: record.name,
    kind: record.kind,
    origin: record.origin,
    missing: record.origin === 'missing' || record.validation.state === 'error',
  }));
  const byKindAndSource = new Map<string, AssetRecord[]>();
  for (const record of records) {
    const key = `${record.kind}:${record.sourceId}`;
    const bucket = byKindAndSource.get(key) ?? [];
    bucket.push(record);
    byKindAndSource.set(key, bucket);
  }
  const edges: AssetGraphEdge[] = [];
  for (const record of records) {
    for (const ref of record.dependencies.refs) {
      const target = byKindAndSource.get(`${ref.kind}:${ref.sourceId}`)?.[0];
      const missing = record.dependencies.missing.some(
        (candidate) => candidate.kind === ref.kind && candidate.sourceId === ref.sourceId,
      );
      edges.push({
        from: record.assetId,
        to: target?.assetId ?? ref.assetId,
        label: ref.label,
        missing,
      });
    }
  }
  return { nodes, edges };
}
