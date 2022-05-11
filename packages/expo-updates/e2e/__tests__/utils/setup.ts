import spawnAsync from '@expo/spawn-async';
import fs from 'fs/promises';
import path from 'path';

export async function setupAsync(
  workingDir: string,
  repoRoot: string,
  runtimeVersion: string
): Promise<string> {
  // initialize project
  await spawnAsync('expo-cli', ['init', 'updates-e2e', '--yes'], {
    cwd: workingDir,
    stdio: 'inherit',
  });
  const projectRoot = path.join(workingDir, 'updates-e2e');

  // add local dependencies
  let packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8'));
  packageJson = {
    ...packageJson,
    resolutions: {
      ...(packageJson.resolutions ?? {}),
      resolutions: {
        'expo-application': 'file:../expo/packages/expo-application',
        'expo-constants': 'file:../expo/packages/expo-constants',
        'expo-eas-client': 'file:../expo/packages/expo-eas-client',
        'expo-error-recovery': 'file:../expo/packages/expo-error-recovery',
        'expo-file-system': 'file:../expo/packages/expo-file-system',
        'expo-font': 'file:../expo/packages/expo-font',
        'expo-json-utils': 'file:../expo/packages/expo-json-utils',
        'expo-keep-awake': 'file:../expo/packages/expo-keep-awake',
        'expo-manifests': 'file:../expo/packages/expo-manifests',
        'expo-modules-core': 'file:../expo/packages/expo-modules-core',
        'expo-structured-headers': 'file:../expo/packages/expo-structured-headers',
        'expo-updates-interface': 'file:../expo/packages/expo-updates-interface',
      },
    },
  };
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(packageJson, null, 2),
    'utf-8'
  );
  await spawnAsync(
    'yarn',
    [
      'add',
      'file:../expo/packages/expo-updates',
      'file:../expo/packages/expo',
      'file:../expo/packages/expo-splash-screen',
      'file:../expo/packages/expo-status-bar',
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    }
  );

  // configure app.json
  let appJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'app.json'), 'utf-8'));
  appJson = {
    ...appJson,
    name: 'updates-e2e',
    runtimeVersion,
    plugins: ['expo-updates'],
    android: { ...(appJson.android ?? {}), package: 'dev.expo.updatese2e' },
    ios: { ...(appJson.ios ?? {}), bundleIdentifier: 'dev.expo.updatese2e' },
    updates: {
      ...(appJson.updates ?? {}),
      url: `http://${process.env.UPDATES_HOST}:${process.env.UPDATES_PORT}/update`,
    },
  };
  await fs.writeFile(path.join(projectRoot, 'app.json'), JSON.stringify(appJson, null, 2), 'utf-8');

  // generate and configure code signing
  await spawnAsync(
    'yarn',
    [
      'expo-updates',
      'codesigning:generate',
      '--key-output-directory',
      'keys',
      '--certificate-output-directory',
      'certs',
      '--certificate-validity-duration-years',
      '1',
      '--certificate-common-name',
      '"E2E Test App"',
    ],
    { cwd: projectRoot, stdio: 'inherit' }
  );
  await spawnAsync(
    'yarn',
    [
      'expo-updates',
      'codesigning:configure',
      '--certificate-input-directory',
      'certs',
      '--key-input-directory',
      'keys',
    ],
    { cwd: projectRoot, stdio: 'inherit' }
  );

  // pack local template and prebuild
  await spawnAsync('npm', ['pack', '--pack-destination', projectRoot], {
    cwd: path.join(repoRoot, 'templates', 'expo-template-bare-minimum'),
    stdio: 'inherit',
  });
  await spawnAsync('expo-cli', ['prebuild', '--template', 'expo-template-bare-minimum-*.tgz'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  // copy App.js from test fixtures
  const appJsSourcePath = path.resolve(__dirname, '..', 'fixtures', 'App.js');
  const appJsDestinationPath = path.resolve(projectRoot, 'App.js');
  let appJsFileContents = await fs.readFile(appJsSourcePath, 'utf-8');
  appJsFileContents = appJsFileContents
    .replace('UPDATES_HOST', process.env.UPDATES_HOST)
    .replace('UPDATES_PORT', process.env.UPDATES_PORT);
  await fs.writeFile(appJsDestinationPath, appJsFileContents, 'utf-8');

  // export update for test server to host
  await spawnAsync('expo-cli', ['export', '--public-url', 'https://u.expo.dev/dummy-url'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  return projectRoot;
}
