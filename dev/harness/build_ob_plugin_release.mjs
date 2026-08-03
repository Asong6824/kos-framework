import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
await mkdir(join(output, 'kos-agent/dist/eval-schemas'), { recursive: true });
await mkdir(join(output, 'kos-agent/node_modules/@silvia-odwyer'), { recursive: true });
await mkdir(join(output, 'kos-agent/THIRD_PARTY_LICENSES'), { recursive: true });
await mkdir(join(output, 'THIRD_PARTY_LICENSES'), { recursive: true });

for (const name of ['main.js', 'manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md']) {
  await cp(join(pluginDir, name), join(output, name));
}
await cp(join(pluginDir, 'assets'), join(output, 'assets'), { recursive: true });
await cp(
  join(pluginDir, 'upstream/livesync/LICENSE'),
  join(output, 'THIRD_PARTY_LICENSES/LiveSync-LICENSE'),
);
await cp(
  join(pluginDir, 'upstream/livesync/source/lib/LICENSE'),
  join(output, 'THIRD_PARTY_LICENSES/livesync-commonlib-LICENSE'),
);
await cp(
  join(pluginDir, 'node_modules/@aws-sdk/client-s3/LICENSE'),
  join(output, 'THIRD_PARTY_LICENSES/Apache-2.0-LICENSE'),
);
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
  join(agentDir, 'src/kos/evals/schemas'),
  join(output, 'kos-agent/dist/eval-schemas'),
  { recursive: true },
);
await cp(
  join(root, 'agent/node_modules/@silvia-odwyer/photon-node'),
  join(output, 'kos-agent/node_modules/@silvia-odwyer/photon-node'),
  { recursive: true },
);
await cp(join(root, 'agent/upstream/LICENSE.pi'), join(output, 'kos-agent/THIRD_PARTY_LICENSES/Pi-LICENSE'));
await cp(join(agentDir, 'THIRD_PARTY_NOTICES.md'), join(output, 'kos-agent/THIRD_PARTY_NOTICES.md'));
await cp(
  join(root, 'agent/node_modules/@silvia-odwyer/photon-node/LICENSE.md'),
  join(output, 'kos-agent/THIRD_PARTY_LICENSES/photon-node-LICENSE.md'),
);
for (const [source, name] of [
  ['@mozilla/readability/LICENSE.md', 'readability-LICENSE.md'],
  ['linkedom/LICENSE', 'linkedom-LICENSE'],
  ['turndown/LICENSE', 'turndown-LICENSE'],
  ['unpdf/LICENSE', 'unpdf-LICENSE'],
]) {
  await cp(join(root, 'agent/node_modules', source), join(output, 'kos-agent/THIRD_PARTY_LICENSES', name));
}

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
const harnessLauncher = join(output, 'kos-agent/dist/kos-harness');
await writeFile(harnessLauncher, '#!/usr/bin/env sh\nexec "${KOS_NODE_PATH:-node}" "$(dirname "$0")/kos-harness.mjs" "$@"\n');
await chmod(harnessLauncher, 0o755);
await writeFile(
  join(output, 'kos-agent/dist/kos-harness.cmd'),
  '@echo off\r\nif defined KOS_NODE_PATH (\r\n  "%KOS_NODE_PATH%" "%~dp0kos-harness.mjs" %*\r\n) else (\r\n  node "%~dp0kos-harness.mjs" %*\r\n)\r\n',
);
await build({
  entryPoints: [join(agentDir, 'src/kos-cli.ts')],
  outfile: join(output, 'kos-agent/dist/kos-harness.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
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
  const harness = spawnSync(
    process.execPath,
    [join(output, 'kos-agent/dist/kos-harness.mjs'), 'validate', '--root', join(root, 'vault'), '--format', 'json'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (harness.status !== 0) throw new Error(harness.stderr || `kos-harness exited with ${String(harness.status)}`);
  const validation = JSON.parse(harness.stdout);
  if (validation.passed !== true || validation.errorCount !== 0) throw new Error('invalid kos-harness smoke response');
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
await writeFile(join(output, 'INSTALL.md'), [
  `# ${manifest.name} ${manifest.version}`,
  '',
  '将此目录复制到 `<Vault>/.obsidian/plugins/kos-companion`，最终应直接看到 `manifest.json`、`main.js`、`styles.css` 和 `kos-agent/`。',
  '在 Obsidian 的“设置 → 第三方插件”中关闭 Restricted Mode，并手动启用 kos Companion。',
  '全新安装会自动打开首次使用向导；关闭后可从命令面板或 kos Companion 设置重新打开。',
  '配置同步时只填写 Cloudflare Account ID、私有 Bucket、Access Key ID 和 Secret Access Key；不要填写完整 endpoint 或 Token value。',
  '填写 R2 配置后先点“测试 R2 读写”，测试通过后才能首次启用同步。',
  'iPad 端不需要 Node.js，也不运行 kos-agent；启用插件后，在设置的“多端同步”中点“从剪贴板加入”，粘贴桌面端生成的临时加入码。',
  '加入码包含 R2 凭据且未加密，在凭据轮换前仍然有效；只通过可信设备间剪贴板传递，导入后立即清空剪贴板。',
  'Keep plugin backups outside `<Vault>/.obsidian/plugins/`. A backup that still contains `manifest.json` with the same plugin id can be loaded instead of the active directory.',
  '桌面端如需 kos-agent：内置 host 会被自动发现，需要 Node.js 22.19+；模型从 Agent 侧栏配置。',
  '火山引擎 Coding Plan 用户可点击同名预设，再填写套餐 API key 并点“保存并测试”；预设固定使用套餐专用 `/api/coding/v3` 网关，不能改为普通方舟 `/api/v3`。',
  '桌面端首次验证可运行 `node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs validate`，预期结果为 `Harness: PASS`、`Errors: 0`。',
  '',
].join('\n'));

const mobileOutput = `${output}-mobile`;
await rm(mobileOutput, { recursive: true, force: true });
await mkdir(mobileOutput, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md']) {
  await cp(join(output, name), join(mobileOutput, name));
}
const mobileBundle = await readFile(join(mobileOutput, 'main.js'), 'utf8');
if (/\brequire\((['"])events\1\)/.test(mobileBundle)) {
  throw new Error('mobile plugin bundle still requires the Node built-in "events" module');
}
await cp(join(output, 'assets'), join(mobileOutput, 'assets'), { recursive: true });
await cp(join(output, 'THIRD_PARTY_LICENSES'), join(mobileOutput, 'THIRD_PARTY_LICENSES'), { recursive: true });
await writeFile(join(mobileOutput, 'INSTALL.md'), [
  `# ${manifest.name} ${manifest.version} · iPad`,
  '',
  '将此目录安装为 `<Vault>/.obsidian/plugins/kos-companion`，目录根部应直接包含 `manifest.json`、`main.js` 和 `styles.css`。',
  '在 Obsidian 的“设置 → 第三方插件”中关闭 Restricted Mode，并手动启用 kos Companion。iPad 不需要 Node.js，也不会显示或启动 kos-agent。',
  '全新安装会自动打开移动端首次使用向导；也可从命令面板或 kos Companion 设置重新打开。',
  '在桌面端 kos Companion 设置中点“复制本机加入码”，再在 iPad 的“多端同步”中点“从剪贴板加入”。',
  '加入码包含 R2 凭据且未加密，在凭据轮换前仍然有效；只通过可信设备间剪贴板传递，导入成功后立即清空剪贴板。',
  '打开驾驶舱的系统卡查看同步状态；iPadOS 挂起 Obsidian 时不承诺后台同步，重新打开后会自动追平。',
  '加入码、加载失败、目录不全或状态不更新时，阅读 Vault 中的 `90_系统/文档/66_多端同步故障排查.md`；不要删除 checkpoint 或清空 Bucket 试错。',
  '',
].join('\n'));

console.log(output);
console.log(mobileOutput);
