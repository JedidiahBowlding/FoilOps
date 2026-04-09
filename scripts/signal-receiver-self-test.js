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
    sourceSystem: 'handi-cat-intelligence',
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
    unsigned.status >= 400,
    `unsigned request expected rejection but got ${unsigned.status}`,
  );

  const signedHeaders = {
    'Content-Type': 'application/json',
    'X-Signal-Source': 'handi-cat-intelligence',
    'X-Signal-Timestamp': timestamp,
    'X-Signal-Signature': validSignature,
    'X-Idempotency-Key': signalId,
  };

  const accepted = await postSignal(endpoint, payload, signedHeaders);
  assert(accepted.status === 202, `signed request expected 202 but got ${accepted.status}`);

  const duplicate = await postSignal(endpoint, payload, signedHeaders);
  assert(duplicate.status === 409, `duplicate request expected 409 but got ${duplicate.status}`);

  console.log('SELF_TEST_OK');
  console.log(JSON.stringify({ health, accepted, duplicate }, null, 2));
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
