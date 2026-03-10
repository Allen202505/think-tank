import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'public', '头像');
const destDir = path.join(projectRoot, 'public', 'avatars');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyFlatImages(fromDir, toDir) {
  const entries = await fs.readdir(fromDir, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => /\.(png|jpe?g|webp|gif)$/i.test(name));

  await ensureDir(toDir);
  await Promise.all(
    files.map(async (name) => {
      const from = path.join(fromDir, name);
      const to = path.join(toDir, name);
      await fs.copyFile(from, to);
    }),
  );

  return files.length;
}

async function main() {
  if (!(await exists(srcDir))) {
    // No-op if source folder doesn't exist (e.g. minimal deployments)
    return;
  }
  const count = await copyFlatImages(srcDir, destDir);
  // eslint-disable-next-line no-console
  console.log(`[sync-avatars] Copied ${count} file(s) from public/头像 -> public/avatars`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[sync-avatars] Failed:', err);
  process.exit(1);
});

