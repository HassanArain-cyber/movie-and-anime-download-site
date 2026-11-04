// Test-process-only transport seam. The application has no insecure endpoint
// override: real validation, VAPID signing and encryption execute unchanged.
if (process.env.E2E_PUSH_TRANSPORT === '1') {
  const https = require('node:https');
  const http = require('node:http');
  const target = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Mock push transport refuses a remote database');
  const original = https.request;
  https.request = function(options, callback) {
    if (options.hostname === 'fcm.googleapis.com') {
      if (!options.path.startsWith('/fcm/send/vault-e2e-')) throw new Error('Unexpected push endpoint in E2E');
      return http.request({ ...options, hostname: '127.0.0.1', port: Number(process.env.MOCK_PUSH_PORT || 9002) }, callback);
    }
    return original.apply(this, arguments);
  };
}
