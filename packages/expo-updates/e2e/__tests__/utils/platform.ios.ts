import spawnAsync from '@expo/spawn-async';
import fs from 'fs/promises';
import path from 'path';

export async function buildAsync(projectRoot: string, destinationFolder: string): Promise<string> {
  await spawnAsync(
    'xcodebuild',
    [
      '-workspace',
      'updatese2e.xcworkspace',
      '-scheme',
      'updatese2e',
      '-configuration',
      'Release',
      '-destination',
      '"generic/platform=iOS',
      'Simulator"',
      '-derivedDataPath',
      './build',
      'build',
    ],
    {
      cwd: path.join(projectRoot, 'android'),
      stdio: 'inherit',
    }
  );
  const destinationPath = path.join(destinationFolder, `ios-release-${new Date().getTime()}.app`);
  await fs.cp(
    path.join(
      projectRoot,
      'ios',
      'build',
      'Build',
      'Products',
      'Release-iphonesimulator',
      'updatese2e.app'
    ),
    destinationPath
  );
  return destinationPath;
}
