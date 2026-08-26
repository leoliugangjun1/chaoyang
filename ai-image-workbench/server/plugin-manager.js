import fs from 'node:fs/promises';
import path from 'node:path';
import { PlatformError } from '../src/shared/protocol.js';

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const keyFor = (manifest) => `${manifest.pluginId}@${manifest.version}`;

export class PluginManager {
  constructor(root, pluginRoot) {
    this.root = root;
    const configuredRoot = pluginRoot || process.env.WORKBENCH_PLUGIN_ROOT;
    this.pluginRoot = configuredRoot ? path.resolve(root, configuredRoot) : path.resolve(root, '..', 'ai-workbench-plugins');
    this.plugins = [];
    this.quarantine = [];
    this.stateFile = path.join(root, 'data', 'registry', 'plugins.json');
    this.state = {};
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try { this.state = await readJson(this.stateFile); } catch { this.state = {}; }
    await this.discover();
  }

  async discover() {
    this.plugins = [];
    this.quarantine = [];
    const base = this.pluginRoot;
    let pluginDirs = [];
    try { pluginDirs = await fs.readdir(base, { withFileTypes: true }); } catch { return; }
    for (const pluginDir of pluginDirs.filter((entry) => entry.isDirectory())) {
      let versions = [];
      try { versions = await fs.readdir(path.join(base, pluginDir.name), { withFileTypes: true }); } catch { continue; }
      for (const version of versions.filter((entry) => entry.isDirectory())) {
        const dir = path.join(base, pluginDir.name, version.name);
        try { this.plugins.push(await this.load(dir)); } catch (error) {
          this.quarantine.push({ path: dir, code: error.code || 'PLUGIN_INVALID', error: error.message });
        }
      }
    }
    this.plugins.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name) || b.manifest.version.localeCompare(a.manifest.version));
  }

  async load(dir) {
    const manifest = await readJson(path.join(dir, 'plugin.manifest.json'));
    const [capabilities, configSchema] = await Promise.all([readJson(path.join(dir, 'capabilities.json')), readJson(path.join(dir, 'config.schema.json'))]);
    if (!manifest.pluginId || !manifest.name || !manifest.version || !Array.isArray(manifest.provides)) {
      throw new PlatformError('PLUGIN_MANIFEST_INVALID', 'Plugin manifest requires identity and provides.');
    }
    if (!Array.isArray(capabilities.capabilities) || capabilities.capabilities.some((capability) => !manifest.provides.includes(capability.name)) || !Array.isArray(configSchema.fields)) {
      throw new PlatformError('PLUGIN_CAPABILITIES_INVALID', 'Plugin capabilities must be declared by the manifest.');
    }
    const key = keyFor(manifest);
    const saved = this.state[key] || {};
    return { dir, key, manifest, capabilities, configSchema, status: saved.status === 'disabled' ? 'disabled' : 'ready', installedAt: saved.installedAt || new Date().toISOString(), health: saved.health || 'healthy' };
  }

  async persist() { await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8'); }

  list() { return this.plugins.map(({ dir, ...plugin }) => plugin); }
  get(key) { const plugin = this.plugins.find((item) => item.key === key); if (!plugin) throw new PlatformError('PLUGIN_NOT_FOUND', 'Plugin version is unavailable.'); return plugin; }

  async action(key, action) {
    const plugin = this.get(key);
    if (!['enable', 'disable', 'health'].includes(action)) throw new PlatformError('PLUGIN_ACTION_INVALID', 'Unsupported plugin action.');
    if (action === 'disable') plugin.status = 'disabled';
    if (action === 'enable') { plugin.status = 'ready'; plugin.health = 'healthy'; }
    if (action === 'health') plugin.health = plugin.status === 'ready' ? 'healthy' : 'disabled';
    this.state[key] = { status: plugin.status, health: plugin.health, installedAt: plugin.installedAt };
    await this.persist();
    return this.list().find((item) => item.key === key);
  }

  provider(capability) {
    return this.plugins.find((plugin) => plugin.status === 'ready' && plugin.health === 'healthy' && plugin.manifest.provides.includes(capability)) || null;
  }
}
