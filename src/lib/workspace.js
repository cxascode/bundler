import { CORE_BUNDLE_NAME, getTfExportResourceName } from './resourceModel.js';

export const WORKSPACE_SCHEMA = 'cxascode-exportbuilder';
export const WORKSPACE_VERSION = 1;

export function buildWorkspace({ bundles, model }) {
  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    exportedAt: new Date().toISOString(),
    bundles: bundles.map((bundle, bundleIndex) => {
      const generatedBundle = model?.bundles?.find(item => item.name === bundle.name);

      return {
        name: bundle.name,
        mode: bundle.mode === 'paste' ? 'paste' : 'catalog',
        tfExportResourceName: generatedBundle?.tfExportResourceName || getTfExportResourceName(bundleIndex, bundle.name),
        selectedResources: Array.isArray(bundle.selectedResources) ? bundle.selectedResources : [],
        pastedIncludeFilterResources: bundle.pastedIncludeFilterResources || '',
        firstLevelDependencies: generatedBundle?.firstLevelDependencies || [],
        includeFilterResources: generatedBundle?.includeFilterResources || [],
        replaceWithDatasource: generatedBundle?.replaceWithDatasource || [],
      };
    }),
  };
}

export function downloadJsonFile({ filename, data }) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function parseWorkspace({ rawText, knownResources, sanitizeBundleName, createId }) {
  const workspace = JSON.parse(rawText || '{}');

  if (workspace.schema !== WORKSPACE_SCHEMA || !Array.isArray(workspace.bundles)) {
    throw new Error('INVALID_WORKSPACE');
  }

  const knownResourceSet = new Set(knownResources);
  const seenNames = new Set();

  const bundles = workspace.bundles
    .map(bundle => {
      const name = sanitizeBundleName(String(bundle.name || ''));
      const selectedResources = Array.isArray(bundle.selectedResources)
        ? [...new Set(bundle.selectedResources)].filter(resource => knownResourceSet.has(resource)).sort()
        : [];

      return {
        id: createId(),
        name,
        mode: bundle.mode === 'paste' ? 'paste' : 'catalog',
        selectedResources,
        pastedIncludeFilterResources: String(bundle.pastedIncludeFilterResources || ''),
      };
    })
    .filter(bundle => {
      if (!bundle.name || seenNames.has(bundle.name)) return false;
      seenNames.add(bundle.name);
      return true;
    });

  return { bundles: applyCoreBundleName(bundles) };
}

function applyCoreBundleName(bundles) {
  if (bundles.length === 0 || bundles[0].name === CORE_BUNDLE_NAME) return bundles;

  return [{ ...bundles[0], name: CORE_BUNDLE_NAME }, ...bundles.slice(1)];
}
