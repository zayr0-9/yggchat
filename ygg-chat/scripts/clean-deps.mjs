import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = [
  'node_modules',
  'client/ygg-chat-r/node_modules',
  'client/ygg-chat-r/dist',
  'client/ygg-chat-r/release',
];

for (const target of targets) {
  const absoluteTarget = resolve(process.cwd(), target);
  try {
    rmSync(absoluteTarget, { recursive: true, force: true });
    console.log(`[clean-deps] removed: ${target}`);
  } catch (error) {
    console.error(`[clean-deps] failed: ${target}`);
    console.error(error);
    process.exitCode = 1;
  }
}
