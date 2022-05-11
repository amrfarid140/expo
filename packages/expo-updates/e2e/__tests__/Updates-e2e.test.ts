import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Dictionary, serializeDictionary } from 'structured-headers';
import { setTimeout } from 'timers/promises';
import uuid from 'uuid/v4';

import * as Platform from './utils/platform';
import * as Server from './utils/server';
import * as Setup from './utils/setup';
import * as Simulator from './utils/simulator';
import { copyBundleToStaticFolder } from './utils/update';

const SERVER_HOST = process.env.UPDATES_HOST;
const SERVER_PORT = parseInt(process.env.UPDATES_PORT, 10);
const ARTIFACTS_DEST = process.env.ARTIFACTS_DEST;

const RUNTIME_VERSION = '1.0.0';

const TIMEOUT_BIAS = process.env.CI ? 10 : 1;

let projectRoot: string | null = null;
let updateDistPath: string | null = null;
let codeSigningPrivateKeyPath: string | null = null;
let plainTestAppPath: string | null = null;

async function getPrivateKeyAsync() {
  const pemBuffer = fs.readFileSync(path.resolve(codeSigningPrivateKeyPath));
  return pemBuffer.toString('utf8');
}

function signRSASHA256(data: string, privateKey: string) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data, 'utf8');
  sign.end();
  return sign.sign(privateKey, 'base64');
}

function convertToDictionaryItemsRepresentation(obj: { [key: string]: string }): Dictionary {
  return new Map(
    Object.entries(obj).map(([k, v]) => {
      return [k, [v, new Map()]];
    })
  );
}

async function serveUpdateWithManifest(manifest: any) {
  const privateKey = await getPrivateKeyAsync();
  const manifestString = JSON.stringify(manifest);
  const hashSignature = signRSASHA256(manifestString, privateKey);
  const dictionary = convertToDictionaryItemsRepresentation({
    sig: hashSignature,
    keyid: 'main',
  });
  const signature = serializeDictionary(dictionary);
  Server.serveManifest(manifest, { 'expo-protocol-version': '0', 'expo-signature': signature });
}

beforeAll(async () => {
  const repoRoot = process.env.EXPO_REPO_ROOT;
  if (!repoRoot) {
    throw new Error(
      'You must provide the path to the repo root in the EXPO_REPO_ROOT environment variable'
    );
  }
  projectRoot = process.env.TEST_PROJECT_ROOT;
  if (!projectRoot) {
    projectRoot = await Setup.setupAsync(path.resolve(repoRoot, '..'), repoRoot, RUNTIME_VERSION);
  }
  updateDistPath = path.join(projectRoot, 'dist');
  codeSigningPrivateKeyPath = path.join(projectRoot, 'keys', 'private-key.pem');
  // build a plain test app with the default settings
  plainTestAppPath = await Platform.buildAsync(projectRoot, ARTIFACTS_DEST);
});

beforeEach(async () => {});

afterEach(async () => {
  await Simulator.uninstallApp();
  Server.stop();
});

test('starts app, stops, and starts again', async () => {
  jest.setTimeout(300000 * TIMEOUT_BIAS);
  Server.start(SERVER_PORT);
  await Simulator.installApp(plainTestAppPath);
  await Simulator.startApp();
  const response = await Server.waitForResponse(10000 * TIMEOUT_BIAS);
  expect(response).toBe('test');
  await Simulator.stopApp();

  await expect(Server.waitForResponse(5000 * TIMEOUT_BIAS)).rejects.toThrow(
    'Timed out waiting for response'
  );

  await Simulator.startApp();
  const response2 = await Server.waitForResponse(10000 * TIMEOUT_BIAS);
  expect(response2).toBe('test');
});

test('initial request includes correct update-id headers', async () => {
  jest.setTimeout(300000 * TIMEOUT_BIAS);
  Server.start(SERVER_PORT);
  await Simulator.installApp(plainTestAppPath);
  await Simulator.startApp();
  const request = await Server.waitForUpdateRequest(10000 * TIMEOUT_BIAS);
  expect(request.headers['expo-embedded-update-id']).toBeDefined();
  expect(request.headers['expo-current-update-id']).toBeDefined();
  // before any updates, the current update ID and embedded update ID should be the same
  expect(request.headers['expo-current-update-id']).toEqual(
    request.headers['expo-embedded-update-id']
  );
});

test('downloads and runs update, and updates current-update-id header', async () => {
  jest.setTimeout(300000 * TIMEOUT_BIAS);
  const bundleFilename = 'bundle1.js';
  const newNotifyString = 'test-update-1';
  const hash = await copyBundleToStaticFolder(updateDistPath, bundleFilename, newNotifyString);
  const manifest = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    runtimeVersion: RUNTIME_VERSION,
    launchAsset: {
      hash,
      key: 'test-update-1-key',
      contentType: 'application/javascript',
      url: `http://${SERVER_HOST}:${SERVER_PORT}/static/${bundleFilename}`,
    },
    assets: [],
    metadata: {},
    extra: {},
  };

  Server.start(SERVER_PORT);
  await serveUpdateWithManifest(manifest);
  await Simulator.installApp(plainTestAppPath);
  await Simulator.startApp();
  const firstRequest = await Server.waitForUpdateRequest(10000 * TIMEOUT_BIAS);
  const response = await Server.waitForResponse(10000 * TIMEOUT_BIAS);
  expect(response).toBe('test');

  // give the app time to load the new update in the background
  await setTimeout(2000 * TIMEOUT_BIAS);
  expect(Server.consumeRequestedStaticFiles().length).toBe(1);

  // restart the app so it will launch the new update
  await Simulator.stopApp();
  await Simulator.startApp();
  const secondRequest = await Server.waitForUpdateRequest(10000 * TIMEOUT_BIAS);
  const updatedResponse = await Server.waitForResponse(10000 * TIMEOUT_BIAS);
  expect(updatedResponse).toBe(newNotifyString);

  expect(secondRequest.headers['expo-embedded-update-id']).toBeDefined();
  expect(secondRequest.headers['expo-embedded-update-id']).toEqual(
    firstRequest.headers['expo-embedded-update-id']
  );
  expect(secondRequest.headers['expo-current-update-id']).toBeDefined();
  expect(secondRequest.headers['expo-current-update-id']).toEqual(manifest.id);
});

// important for usage accuracy
test('does not download any assets for an older update', async () => {
  jest.setTimeout(300000 * TIMEOUT_BIAS);
  const bundleFilename = 'bundle-old.js';
  const hash = await copyBundleToStaticFolder(updateDistPath, bundleFilename, 'test-update-older');
  const manifest = {
    id: uuid(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // yesterday
    runtimeVersion: RUNTIME_VERSION,
    launchAsset: {
      hash,
      key: 'test-update-old-key',
      contentType: 'application/javascript',
      url: `http://${SERVER_HOST}:${SERVER_PORT}/static/${bundleFilename}`,
    },
    assets: [],
    metadata: {},
    extra: {},
  };

  Server.start(SERVER_PORT);
  await serveUpdateWithManifest(manifest);
  await Simulator.installApp(plainTestAppPath);
  await Simulator.startApp();
  await Server.waitForUpdateRequest(10000 * TIMEOUT_BIAS);
  const firstResponse = await Server.waitForResponse(10000 * TIMEOUT_BIAS);
  expect(firstResponse).toBe('test');

  // give the app time to load the new update in the background (i.e. to make sure it doesn't)
  await setTimeout(3000 * TIMEOUT_BIAS);
  expect(Server.consumeRequestedStaticFiles().length).toBe(0);

  // restart the app and make sure it's still running the initial update
  await Simulator.stopApp();
  await Simulator.startApp();
  const secondResponse = await Server.waitForResponse(10000 * TIMEOUT_BIAS);
  expect(secondResponse).toBe('test');
});
