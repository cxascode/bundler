import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ArrowRight, RotateCcw, Download, Upload, CheckCircle2, Search, ClipboardCopy } from 'lucide-react';
import resources from './data/resources.json';
import { buildFallbackCatalog, parseResourceCatalog } from './lib/resourceCatalog.js';
import { buildBundleModel } from './lib/bundleModel.js';
import {
  cleanName,
  getAssignedResources,
  getAvailableBundleResources,
  getBundleResources,
  getBundleStats,
  validateBundles,
} from './lib/resourceModel.js';
import { buildWorkspace, downloadJsonFile, parseWorkspace } from './lib/workspace.js';
import { parsePastedResourceTypes } from './lib/includeFilterParser.js';
import {
  buildDependencyTreeUrl,
  buildDependencyTreeVersionOptionsFromIndex,
  cacheDependencyTreeVersionOptions,
  DEPENDENCY_TREE_INDEX_URL,
  getCachedDependencyTreeVersionOptions,
  getDependencyTreeVersionLabel,
  LATEST_DEPENDENCY_TREE_VERSION,
} from './lib/dependencyTreeVersions.js';

const BUNDLED_RESOURCE_CATALOG = buildFallbackCatalog(resources);

function formatTerraformResourceList(values) {
  return values.map(value => `    "${value}"`).join(',\n');
}

function getLegacyArchitectFlowExporterLine(bundle) {
  if (bundle?.useLegacyArchitectFlowExporter === true) {
    return '  use_legacy_architect_flow_exporter = true\n';
  }

  return '  use_legacy_architect_flow_exporter = false\n';
}

function buildTfExportTemplate(bundle) {
  const includeFilterResources = bundle?.includeFilterResources || [];
  const replaceWithDatasource = bundle?.replaceWithDatasource || [];
  const tfExportResourceName = bundle?.tfExportResourceName || 'tf_export';

  const includeFilterBlock = includeFilterResources.length === 0
    ? '  include_filter_resources           = []\n'
    : `  include_filter_resources           = [
${formatTerraformResourceList(includeFilterResources)}
  ]
`;

  const replaceWithDatasourceBlock = replaceWithDatasource.length === 0
    ? '  replace_with_datasource            = []\n'
    : `  replace_with_datasource            = [
${formatTerraformResourceList(replaceWithDatasource)}
  ]
`;

  return `resource "genesyscloud_tf_export" "${tfExportResourceName}" {
  directory                          = "./genesyscloud"
  enable_dependency_resolution       = true
  export_format                      = "hcl"
  exclude_attributes                 = []
  include_state_file                 = false
${includeFilterBlock}  log_permission_errors              = true
${replaceWithDatasourceBlock}  split_files_by_resource            = false
${getLegacyArchitectFlowExporterLine(bundle)}}`;
}

function buildDefaultBundle(name = 'export') {
  return {
    id: crypto.randomUUID(),
    name,
    mode: 'catalog',
    tfExportResourceName: 'tf_export',
    selectedResources: [],
    pastedIncludeFilterResources: '',
  };
}

export default function App() {
  const initialState = useMemo(() => {
    const bundle = buildDefaultBundle();
    return { bundles: [bundle], selectedBundleId: bundle.id };
  }, []);
  const [resourceCatalog, setResourceCatalog] = useState(BUNDLED_RESOURCE_CATALOG);
  const [selectedCatalogVersion, setSelectedCatalogVersion] = useState(LATEST_DEPENDENCY_TREE_VERSION);
  const [catalogVersionOptions, setCatalogVersionOptions] = useState(() => getCachedDependencyTreeVersionOptions() || [LATEST_DEPENDENCY_TREE_VERSION]);
  const [bundles, setBundles] = useState(initialState.bundles);
  const [selectedBundleId, setSelectedBundleId] = useState(initialState.selectedBundleId);
  const [newBundleName, setNewBundleName] = useState('');
  const [isAddingBundle, setIsAddingBundle] = useState(false);
  const [resourceDialogType, setResourceDialogType] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedQuery, setSelectedQuery] = useState('');
  const [copiedOutput, setCopiedOutput] = useState(null);
  const importRef = useRef(null);
  const allResources = resourceCatalog.resourceTypes;

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalogVersions() {
      const cachedOptions = getCachedDependencyTreeVersionOptions();
      if (cachedOptions) return;

      try {
        const response = await fetch(DEPENDENCY_TREE_INDEX_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Dependency catalog index request failed: ${response.status}`);
        }

        const options = buildDependencyTreeVersionOptionsFromIndex(await response.json());
        setCatalogVersionOptions(cacheDependencyTreeVersionOptions(options));
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }

    loadCatalogVersions();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadResourceCatalog() {
      try {
        const response = await fetch(buildDependencyTreeUrl(selectedCatalogVersion), {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Resource catalog request failed: ${response.status}`);
        }

        const catalog = parseResourceCatalog(await response.json());

        if (catalog.resourceTypes.length === 0) {
          throw new Error('Resource catalog did not contain any resource types.');
        }

        const knownResourceSet = new Set(catalog.resourceTypes);

        setResourceCatalog(catalog);
        setBundles(current => current.map(bundle => ({
          ...bundle,
          selectedResources: getBundleResources(bundle).filter(resource => knownResourceSet.has(resource)),
        })));
      } catch (error) {
        if (error.name === 'AbortError') return;
        setResourceCatalog(BUNDLED_RESOURCE_CATALOG);
      }
    }

    loadResourceCatalog();

    return () => controller.abort();
  }, [selectedCatalogVersion]);

  const selectedBundle = bundles.find(bundle => bundle.id === selectedBundleId) || bundles[0] || buildDefaultBundle();
  const selectedBundleMode = selectedBundle.mode === 'paste' ? 'paste' : 'catalog';
  const catalogBundles = useMemo(() => bundles.filter(bundle => bundle.mode !== 'paste'), [bundles]);
  const selectedBundleResources = getBundleResources(selectedBundle);
  const filteredSelectedBundleResources = selectedBundleResources.filter(resource => resource.includes(selectedQuery));
  const selectedResources = useMemo(() => [...new Set(catalogBundles.flatMap(bundle => getBundleResources(bundle)))].sort(), [catalogBundles]);
  const assigned = useMemo(() => getAssignedResources(catalogBundles), [catalogBundles]);
  const parsedPasteResourceTypes = useMemo(() => {
    return parsePastedResourceTypes(selectedBundle.pastedIncludeFilterResources);
  }, [selectedBundle.pastedIncludeFilterResources]);

  const availableResources = useMemo(() => {
    const selectedSet = new Set(selectedBundleResources);

    return getAvailableBundleResources({
      resources: allResources,
      assigned,
      query,
    }).filter(resource => !selectedSet.has(resource));
  }, [assigned, query, allResources, selectedBundleResources]);

  const stats = useMemo(() => {
    return getBundleStats({
      resources: allResources,
      bundles: catalogBundles,
      assigned,
    });
  }, [assigned, catalogBundles, allResources]);

  const validation = useMemo(() => {
    return validateBundles({ bundles: catalogBundles });
  }, [catalogBundles, allResources]);

  const resourceDialog = useMemo(() => {
    if (resourceDialogType === 'known') {
      return {
        title: 'Known resources',
        description: 'All resource types loaded from the current dependency catalog.',
        resources: allResources,
      };
    }

    if (resourceDialogType === 'selected') {
      return {
        title: 'Selected resources',
        description: 'Resource types currently assigned across all bundles.',
        resources: selectedResources,
      };
    }

    return null;
  }, [allResources, resourceDialogType, selectedResources]);

  const model = useMemo(() => {
    return buildBundleModel({
      dependencyMap: resourceCatalog.dependencyMap,
      bundles,
      stats,
      validation,
    });
  }, [bundles, stats, validation, resourceCatalog.dependencyMap]);

  const selectedGeneratedBundle = useMemo(() => {
    return model.bundles.find(bundle => bundle.name === selectedBundle.name) || model.bundles[0] || null;
  }, [model.bundles, selectedBundle.name]);

  const selectedTfExportTemplate = useMemo(() => {
    return buildTfExportTemplate(selectedGeneratedBundle);
  }, [selectedGeneratedBundle]);

  function startAddingBundle() {
    setNewBundleName('');
    setQuery('');
    setIsAddingBundle(true);
  }

  function cancelAddingBundle() {
    setNewBundleName('');
    setIsAddingBundle(false);
  }

  function addBundle() {
    const name = cleanName(newBundleName || 'export');

    if (!name || bundles.some(bundle => bundle.name === name)) return;

    const bundle = buildDefaultBundle(name);

    setBundles(current => [...current, bundle]);
    setSelectedBundleId(bundle.id);
    setNewBundleName('');
    setQuery('');
    setIsAddingBundle(false);
  }

  function deleteBundle(id) {
    setBundles(current => {
      if (current.length <= 1) return current;

      const next = current.filter(bundle => bundle.id !== id);
      setSelectedBundleId(next[0]?.id || null);
      setQuery('');
      return next;
    });
  }

  function setSelectedBundleMode(mode) {
    if (!selectedBundleId) return;

    setBundles(current => current.map(bundle => {
      return bundle.id === selectedBundleId ? { ...bundle, mode } : bundle;
    }));
  }

  function updatePastedIncludeFilters(value) {
    if (!selectedBundleId) return;

    setBundles(current => current.map(bundle => {
      return bundle.id === selectedBundleId
        ? { ...bundle, pastedIncludeFilterResources: value }
        : bundle;
    }));
  }

  function moveToBundle(resource, bundleId = selectedBundleId) {
    if (!bundleId) return;

    setBundles(current => current.map(bundle => {
      const withoutResource = getBundleResources(bundle).filter(item => item !== resource);

      if (bundle.id === bundleId) {
        return { ...bundle, selectedResources: [...withoutResource, resource].sort() };
      }

      return { ...bundle, selectedResources: withoutResource };
    }));
  }

  function removeFromBundle(resource, bundleId) {
    setBundles(current => current.map(bundle => {
      return bundle.id === bundleId
        ? { ...bundle, selectedResources: getBundleResources(bundle).filter(item => item !== resource) }
        : bundle;
    }));
  }

  function reset() {
    const defaultBundle = buildDefaultBundle();
    setBundles([defaultBundle]);
    setSelectedBundleId(defaultBundle.id);
    setNewBundleName('');
    setIsAddingBundle(false);
    setResourceDialogType(null);
    setQuery('');
  }

  function downloadWorkspace() {
    if (bundles.length === 0) return;

    downloadJsonFile({
      filename: 'bundler-workspace.json',
      data: buildWorkspace({ bundles, model }),
    });
  }

  function importWorkspaceFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const workspace = parseWorkspace({
          rawText: String(reader.result || '{}'),
          knownResources: allResources,
          cleanName,
          createId: () => crypto.randomUUID(),
        });

        setBundles(workspace.bundles.length > 0 ? workspace.bundles : [buildDefaultBundle()]);
        setSelectedBundleId(workspace.bundles[0]?.id || null);
        setNewBundleName('');
        setIsAddingBundle(false);
        setResourceDialogType(null);
        setQuery('');
      } catch {
        window.alert('Unable to read that workspace file. Make sure it is a valid Bundler workspace JSON file.');
      }
    };

    reader.readAsText(file);
  }

  async function copyGeneratedOutput(key, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedOutput(key);
      window.setTimeout(() => setCopiedOutput(current => current === key ? null : current), 1500);
    } catch {
      window.alert('Unable to copy to clipboard. Select the text and copy it manually.');
    }
  }

  return <div className="app">
    <header className="hero">
      <div>
        <p className="eyebrow">CX as Code Bundler</p>
        <h1>Bundle pipeline exports without hand-maintaining dependency wiring.</h1>
        <p className="subhead">A ready-to-wear starter for <code>genesyscloud_tf_export</code>. Bundler seeds <code>include_filter_resources</code>, suggests <code>replace_with_datasource</code> from the dependency tree, and sets <code>enable_dependency_resolution = true</code>. Tailor the rest yourself.</p>

        <section className="card bundle-nav">
          <div className="section-title">
            <div><h2>Bundles</h2><p>Select a bundle to build its export template.</p></div>
            <div className="bundle-nav-actions">
              {!isAddingBundle && <button onClick={startAddingBundle}><Plus size={16}/> Add bundle</button>}
            </div>
          </div>
          {isAddingBundle && <div className="field add-bundle-form">
            <label>Add bundle</label>
            <div className="inline">
              <input value={newBundleName} onChange={event => setNewBundleName(event.target.value)} placeholder="export-name" />
              <button onClick={addBundle}><CheckCircle2 size={16}/> Save</button>
              <button className="ghost" onClick={cancelAddingBundle}>Cancel</button>
            </div>
          </div>}
          <div className="bundle-list">
            {bundles.map(bundle => <button key={bundle.id} className={bundle.id === selectedBundleId ? 'bundle selected' : 'bundle'} onClick={() => { setSelectedBundleId(bundle.id); setQuery(''); setSelectedQuery(''); }}>
              <span><strong>{bundle.name}</strong><small>{getBundleResources(bundle).length} selected</small></span>
              {bundles.length > 1 && <Trash2 className="danger" size={16} onClick={event => { event.stopPropagation(); deleteBundle(bundle.id); }} />}
            </button>)}
          </div>
        </section>
      </div>
      <div className="hero-actions">
        <div className="hero-action-buttons">
          <input ref={importRef} type="file" accept="application/json,.json" onChange={importWorkspaceFile} hidden />
          <button className="ghost" onClick={() => importRef.current?.click()}><Upload size={16}/> Import</button>
          <button className="secondary" onClick={downloadWorkspace} disabled={bundles.length === 0} title={bundles.length === 0 ? 'Create a bundle before exporting a workspace.' : 'Export workspace JSON'}><Download size={16}/> Export</button>
          <button className="ghost" onClick={reset}><RotateCcw size={16}/> Reset</button>
        </div>
        <div className="catalog-version-row">
          <label htmlFor="catalog-version-select">Version:</label>
          <select id="catalog-version-select" className="catalog-version-select" aria-label="Dependency catalog version" value={selectedCatalogVersion} onChange={event => setSelectedCatalogVersion(event.target.value)}>
            {catalogVersionOptions.map(version => <option key={version} value={version}>{getDependencyTreeVersionLabel(version)}</option>)}
          </select>
        </div>
        <div className="hero-stats">
          <button className="stat-card mini-stat stat-button" onClick={() => setResourceDialogType('known')}>
            <div className="mini-stat-heading"><p className="eyebrow">Known</p><strong>{stats.knownResourceCount}</strong></div>
            <span>Resource types</span>
          </button>
          <button className="stat-card mini-stat stat-button" onClick={() => setResourceDialogType('selected')}>
            <div className="mini-stat-heading"><p className="eyebrow">Selected</p><strong>{stats.selectedResourceCount}</strong></div>
            <span>Across bundles</span>
          </button>
          <button className="stat-card mini-stat">
            <div className="mini-stat-heading"><p className="eyebrow">Available</p><strong>{stats.availableResourceCount}</strong></div>
            <span>Unassigned</span>
          </button>
        </div>
      </div>
    </header>

    {resourceDialog && <div className="dialog-backdrop" role="presentation" onClick={() => setResourceDialogType(null)}>
        <section className="card resource-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-dialog-title" onClick={event => event.stopPropagation()}>
          <div className="section-title">
            <div><h2 id="resource-dialog-title">{resourceDialog.title}</h2><p>{resourceDialog.description}</p></div>
            <button className="ghost" onClick={() => setResourceDialogType(null)}>Close</button>
          </div>
          <div className="chips scroll short">
            {resourceDialog.resources.map(resource => <span className="chip" key={resource}>{resource}</span>)}
          </div>
        </section>
      </div>}

      <main className="grid">
        <section className="card mode-panel">
          <div className="section-title">
            <div><h2>Input mode</h2><p>Choose how to build <strong>{selectedBundle.name}</strong>.</p></div>
          </div>
          <div className="mode-toggle">
            <button type="button" className={selectedBundleMode === 'catalog' ? 'mode-option selected' : 'mode-option'} onClick={() => setSelectedBundleMode('catalog')}>Catalog</button>
            <button type="button" className={selectedBundleMode === 'paste' ? 'mode-option selected' : 'mode-option'} onClick={() => setSelectedBundleMode('paste')}>Paste</button>
          </div>
          {selectedBundleMode === 'catalog' ? (
            <p className="mode-help">Pick resource types from the catalog. Bundler expands dependencies into <code>include_filter_resources</code>.</p>
          ) : (
            <p className="mode-help">Paste whole resource types for <code>include_filter_resources</code>. Name patterns are normalized to the bare type. Bundler suggests <code>replace_with_datasource</code> from first-level dependencies.</p>
          )}
        </section>

        {selectedBundleMode === 'catalog' ? <>
        <section className="card available-panel">
          <div className="section-title">
            <div><h2>Available resources</h2><p>Add resource types to <strong>{selectedBundle.name}</strong>. Dependencies are expanded automatically in the export.</p></div>
            <strong>{availableResources.length}</strong>
          </div>
          <div className="search">
            <Search size={16}/>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="filter e.g. flow, routing, outbound" />
            {query && <button className="ghost search-clear" onClick={() => setQuery('')} type="button">clear</button>}
          </div>
          <div className="resource-list">
            {availableResources.map(resource => <div className="resource" key={resource}>
              <code>{resource}</code>
              <button onClick={() => moveToBundle(resource)} title={`Add to ${selectedBundle.name}`}><ArrowRight size={14}/> add</button>
            </div>)}
            {availableResources.length === 0 && <p className="empty">No available resources match that filter.</p>}
          </div>
        </section>

        <section className="card selected-panel">
          <div className="section-title">
            <div><h2>{selectedBundle.name}</h2><p>Primary resource types for this bundle. First-level dependencies drive <code>replace_with_datasource</code>.</p></div>
            <strong>{selectedBundleResources.length}</strong>
          </div>
          <div className="search">
            <Search size={16}/>
            <input value={selectedQuery} onChange={event => setSelectedQuery(event.target.value)} placeholder="filter selected resources" />
            {selectedQuery && <button className="ghost search-clear" onClick={() => setSelectedQuery('')} type="button">clear</button>}
          </div>
          <div className="resource-list">
            {filteredSelectedBundleResources.map(resource => <div className="resource" key={resource}>
              <code>{resource}</code>
              <div className="actions">
                <button className="ghost" onClick={() => removeFromBundle(resource, selectedBundle.id)}>remove</button>
              </div>
            </div>)}
            {filteredSelectedBundleResources.length === 0 && <p className="empty">No selected resources match that filter.</p>}
          </div>
          {selectedGeneratedBundle?.firstLevelDependencies?.length > 0 && <div className="dependency-preview">
            <p className="eyebrow">First-level dependencies</p>
            <div className="chips scroll short">
              {selectedGeneratedBundle.firstLevelDependencies.map(resource => <span className="chip" key={resource}>{resource}</span>)}
            </div>
          </div>}
        </section>
        </> : <section className="card paste-panel">
          <div className="section-title">
            <div>
              <h2>include_filter_resources</h2>
              <p>Paste one whole resource type per line. Patterns like <code>::^Name$</code> are normalized to the bare type.</p>
            </div>
            <strong>{parsedPasteResourceTypes.length}</strong>
          </div>
          <textarea
            className="paste-input"
            value={selectedBundle.pastedIncludeFilterResources || ''}
            onChange={event => updatePastedIncludeFilters(event.target.value)}
            placeholder={`genesyscloud_routing_queue\ngenesyscloud_architect_schedules\ngenesyscloud_flow`}
            spellCheck={false}
          />
          {parsedPasteResourceTypes.length > 0 && <div className="paste-preview">
            <p className="eyebrow">Resource types</p>
            <div className="chips scroll short">
              {parsedPasteResourceTypes.map(resource => <span className="chip" key={resource}>{resource}</span>)}
            </div>
          </div>}
          {selectedGeneratedBundle?.firstLevelDependencies?.length > 0 && <div className="dependency-preview">
            <p className="eyebrow">First-level dependencies</p>
            <div className="chips scroll short">
              {selectedGeneratedBundle.firstLevelDependencies.map(resource => <span className="chip" key={resource}>{resource}</span>)}
            </div>
          </div>}
        </section>}

        <section className="card output">
          <div className="section-title">
            <div><h2>Generated export</h2><p>Preview for bundle: {selectedGeneratedBundle?.name || 'none'}.</p></div>
          </div>

          <div className="generated-file">
            <div className="generated-file-header">
              <h3>tf_export.tf</h3>
              <button className="ghost copy-button" onClick={() => copyGeneratedOutput('tf_export.tf', selectedTfExportTemplate)} title="Copy tf_export.tf to clipboard"><ClipboardCopy size={14}/>{copiedOutput === 'tf_export.tf' ? 'Copied' : 'Copy'}</button>
            </div>
            <pre>{selectedTfExportTemplate}</pre>
          </div>
        </section>
      </main>
  </div>;
}
