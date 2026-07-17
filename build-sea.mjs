// Kimi 2007 —— SEA 单文件 exe 打包脚本
// 用法: node build-sea.mjs （需要网络以下载 postject，仅首次）
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_EXE = path.join(ROOT, 'Kimi2007.exe');
const BLOB = path.join(ROOT, 'sea-prep.blob');

console.log('[1/4] 生成 sea-config.json');
const config = {
  main: path.join(ROOT, 'server.cjs'),
  output: BLOB,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: {
    'index.html': path.join(ROOT, 'public', 'index.html'),
    'style.css': path.join(ROOT, 'public', 'style.css'),
    'app.js': path.join(ROOT, 'public', 'app.js'),
    'kimi.ico': path.join(ROOT, 'kimi.ico'),
  },
};
fs.writeFileSync(path.join(ROOT, 'sea-config.json'), JSON.stringify(config, null, 2));

console.log('[2/4] 生成 SEA blob');
execFileSync(process.execPath, ['--experimental-sea-config', path.join(ROOT, 'sea-config.json')], { stdio: 'inherit' });

console.log('[3/4] 复制 node.exe -> Kimi2007.exe');
fs.copyFileSync(process.execPath, OUT_EXE);

console.log('[4/4] postject 注入 blob');
execSync(
  `npx -y postject "${OUT_EXE}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { stdio: 'inherit', cwd: ROOT },
);

fs.rmSync(BLOB, { force: true });
console.log('打包完成:', OUT_EXE);
