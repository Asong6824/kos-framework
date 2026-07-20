import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pluginDir = join(root, 'ob-plugin');
const agentDir = join(root, 'agent/packages/kos-agent');
const output = resolve(process.argv[2] ?? join(root, 'release/kos-companion'));
const requireFromPlugin = createRequire(join(pluginDir, 'package.json'));
const { build } = requireFromPlugin('esbuild');

await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'kos-agent/dist/modes/interactive/theme'), { recursive: true });
await mkdir(join(output, 'kos-agent/dist/schemas'), { recursive: true });
await mkdir(join(output, 'kos-agent/node_modules/@silvia-odwyer'), { recursive: true });
await mkdir(join(output, 'kos-agent/THIRD_PARTY_LICENSES'), { recursive: true });

for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  await cp(join(pluginDir, name), join(output, name));
}
await cp(join(agentDir, 'package.json'), join(output, 'kos-agent/package.json'));
await cp(
  join(agentDir, 'src/modes/interactive/theme'),
  join(output, 'kos-agent/dist/modes/interactive/theme'),
  { recursive: true },
);
await cp(
  join(agentDir, 'src/kos/validation/schemas'),
  join(output, 'kos-agent/dist/schemas'),
  { recursive: true },
);
await cp(
  join(root, 'agent/node_modules/@silvia-odwyer/photon-node'),
  join(output, 'kos-agent/node_modules/@silvia-odwyer/photon-node'),
  { recursive: true },
);
await cp(join(root, 'agent/upstream/LICENSE.pi'), join(output, 'kos-agent/THIRD_PARTY_LICENSES/Pi-LICENSE'));
await cp(
  join(root, 'agent/node_modules/@silvia-odwyer/photon-node/LICENSE.md'),
  join(output, 'kos-agent/THIRD_PARTY_LICENSES/photon-node-LICENSE.md'),
);

await build({
  entryPoints: [join(agentDir, 'src/rpc-entry.ts')],
  outfile: join(output, 'kos-agent/dist/rpc-entry.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@silvia-odwyer/photon-node'],
  banner: {
    js: "import { createRequire as __kosCreateRequire } from 'node:module'; const require = __kosCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});

const smokeRoot = await mkdtemp(join(tmpdir(), 'kos-agent-release-'));
try {
  const result = spawnSync(process.execPath, [join(output, 'kos-agent/dist/rpc-entry.mjs'), '--continue'], {
    cwd: root,
    env: {
      ...process.env,
      KOS_AGENT_DIR: join(smokeRoot, 'config'),
      KOS_AGENT_SESSION_DIR: join(smokeRoot, 'sessions'),
    },
    input: '{"id":"release-smoke","type":"get_state"}\n',
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || `host exited with ${String(result.status)}`);
  const response = JSON.parse(result.stdout.trim());
  if (response.id !== 'release-smoke' || response.success !== true) throw new Error('invalid host smoke response');
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
await writeFile(join(output, 'INSTALL.md'), [
  `# ${manifest.name} ${manifest.version}`,
  '',
  'Copy this directory to `<Vault>/.obsidian/plugins/kos-companion`, then enable the plugin in Obsidian.',
  'The bundled kos-agent host is discovered automatically. Node.js 22.19+ must be installed.',
  'Configure the model from the Agent sidebar. If Node auto-discovery fails, set its executable in plugin settings.',
  '',
].join('\n'));

console.log(output);
