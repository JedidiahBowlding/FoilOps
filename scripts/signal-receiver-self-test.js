#!/usr/bin/env node

const crypto = require('crypto');

function fail(message) {
  console.error(`SELF_TEST_FAILED: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function sign(secret, timestamp, payload) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

function buildSignal(signalId) {
  return {
    schemaVersion: '1.0',
    signalId,
    emittedAt: new Date().toISOString(),
    sourceSystem: 'foilops-intelligence',
    signalType: 'TOKEN_INVESTIGATION',
    dryRun: true,
    riskScore: 75,
    riskLevel: 'HIGH',
    trackedWallet: null,
    developerWallet: 'dev-wallet-example',
    tokenMint: 'token-mint-example',
    traceAlerts: ['test_alert'],
    actionHint: 'WATCH',
    metadata: { source: 'ci-self-test' },
  };
}

async function postSignal(endpoint, payload, headers) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: payload,
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = { parseError: true };
  }

  return { status: response.status, body };
}

async function run() {
  const baseUrl = process.env.SIGNAL_TEST_BASE_URL || 'http://127.0.0.1:8787';
  const endpoint = `${baseUrl.replace(/\/$/, '')}/signals`;
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
  const secret = process.env.SIGNAL_TEST_AUTH_SECRET || process.env.SIGNAL_AUTH_SECRET;

  if (!secret) {
    fail('missing SIGNAL_TEST_AUTH_SECRET (or SIGNAL_AUTH_SECRET fallback)');
  }

  const healthResponse = await fetch(healthUrl);
  assert(healthResponse.status === 200, `health endpoint returned ${healthResponse.status}`);

  const health = await healthResponse.json();
  assert(health.status === 'ok', 'health status is not ok');

  const signalId = `self-test-${Date.now()}`;
  const signal = buildSignal(signalId);
  const payload = JSON.stringify(signal);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const validSignature = sign(secret, timestamp, payload);

  const unsigned = await postSignal(endpoint, payload, {
    'Content-Type': 'application/json',
    'X-Idempotency-Key': signalId,
  });

  assert(
    unsigned.body?.status === 'rejected',
    `unsigned request expected status=rejected but got ${unsigned.status} ${JSON.stringify(unsigned.body)}`,
  );

  const signedHeaders = {
    'Content-Type': 'application/json',
    'X-Signal-Source': 'foilops-intelligence',
    'X-Signal-Timestamp': timestamp,
    'X-Signal-Signature': validSignature,
    'X-Idempotency-Key': signalId,
  };

  const accepted = await postSignal(endpoint, payload, signedHeaders);
  assert(
    ['accepted', 'executed', 'blocked', 'failed'].includes(accepted.body?.status),
    `signed request expected accepted/executed/blocked/failed but got ${accepted.status} ${JSON.stringify(accepted.body)}`,
  );

  const duplicate = await postSignal(endpoint, payload, signedHeaders);
  assert(
    duplicate.body?.status === 'duplicate',
    `duplicate request expected status=duplicate but got ${duplicate.status} ${JSON.stringify(duplicate.body)}`,
  );

  console.log('SELF_TEST_OK');
  console.log(JSON.stringify({ health, accepted, duplicate }, null, 2));
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
