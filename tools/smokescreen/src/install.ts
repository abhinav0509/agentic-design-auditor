// Installs the pinned Smokescreen release (D-017, D-021) into .cache/ for the egress proxy tests.
// The hashes are pinned here, not read from the release, so a replaced release asset fails.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = 'v0.1.0';
const SHA256: Record<string, string> = {
  darwin_amd64: 'de15f32821f57d07ac6b437f8f1e78e81cda67cde18eb478afad353c5736b081',
  darwin_arm64: 'daaec6a547288cbb65bf76c0322b1b749b276856e131d4b284655aba821ec512',
  linux_amd64: '4e1e447449e3cc653dae956208588722b5c8fe8ce894f633adc756a851d1ec46',
  linux_arm64: 'f15ddd0dc2b2cbc6d7318f441928939eb9bedfab2a1881508af3096a1e24b7c9',
};

const binaryPath = (root: string) => join(root, '.cache', 'smokescreen', VERSION, 'smokescreen');

async function main(root: string): Promise<void> {
  const target = binaryPath(root);
  if (existsSync(target)) {
    console.log(`smokescreen ${VERSION} already at ${target}`);
    return;
  }
  const platform = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
  const expected = SHA256[platform];
  if (!expected) throw new Error(`no pinned smokescreen build for ${platform}`);
  const name = `smokescreen_${VERSION}_${platform}`;
  const res = await fetch(
    `https://github.com/stripe/smokescreen/releases/download/${VERSION}/${name}.tar.gz`,
  );
  if (!res.ok) throw new Error(`download failed: ${String(res.status)}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`sha256 mismatch for ${name}: ${actual}`);
  const tgz = join(tmpdir(), `${name}.tar.gz`);
  writeFileSync(tgz, archive);
  mkdirSync(join(target, '..'), { recursive: true });
  execFileSync('tar', [
    '-xzf',
    tgz,
    '-C',
    join(target, '..'),
    '--strip-components=1',
    `${name}/smokescreen`,
  ]);
  console.log(`installed smokescreen ${VERSION} at ${target}`);
}

await main(process.cwd());
