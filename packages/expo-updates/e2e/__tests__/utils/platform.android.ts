import spawnAsync from '@expo/spawn-async';
import fs from 'fs/promises';
import path from 'path';

export async function buildAsync(projectRoot: string, destinationFolder: string): Promise<string> {
  await spawnAsync('./gradlew', ['assembleRelease', '--stacktrace'], {
    cwd: path.join(projectRoot, 'android'),
    stdio: 'inherit',
  });
  const destinationPath = path.join(
    destinationFolder,
    `android-release-${new Date().getTime()}.apk`
  );
  await fs.copyFile(
    path.join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release'),
    destinationPath
  );
  return destinationPath;
}
