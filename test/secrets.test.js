const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

const state = { clients: 0, requests: [] };

mockModule('@google-cloud/secret-manager', {
    SecretManagerServiceClient: class {
        constructor() {
            state.clients += 1;
        }

        async getProjectId() {
            return 'test-project';
        }

        async accessSecretVersion(request) {
            state.requests.push(request);
            return [{ payload: { data: Buffer.from(`value of ${request.name}\n`) } }];
        }
    },
});

const { readSecret } = require(path.join(__dirname, '../src/secrets'));

describe('secrets', () => {
    it('reads the latest version of a secret in the current project without surrounding whitespace', async () => {
        const value = await readSecret('het-of-de-webhook-secret');

        assert.equal(value, 'value of projects/test-project/secrets/het-of-de-webhook-secret/versions/latest');
    });

    it('reuses one Secret Manager client for several secrets', async () => {
        await Promise.all([readSecret('het-of-de-token'), readSecret('het-of-de-webhook-secret')]);

        assert.equal(state.clients, 1);
    });
});
