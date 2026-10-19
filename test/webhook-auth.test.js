const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

mockModule(path.join(__dirname, '../src/secrets'), {
    readSecret: async () => 'secret',
});

const { isSameSecret } = require(path.join(__dirname, '../src/webhook-auth'));

describe('webhook-auth', () => {
    describe('isSameSecret', () => {
        it('accepts the same secret', () => {
            assert.equal(isSameSecret('secret', 'secret'), true);
        });

        it('rejects a different secret of the same length', () => {
            assert.equal(isSameSecret('secreT', 'secret'), false);
        });

        it('rejects a secret of a different length', () => {
            assert.equal(isSameSecret('secret-longer', 'secret'), false);
        });

        it('rejects a missing secret', () => {
            assert.equal(isSameSecret(undefined, 'secret'), false);
        });

        it('rejects a non-string header value', () => {
            assert.equal(isSameSecret(['secret'], 'secret'), false);
        });

        it('rejects everything while the expected secret is not loaded', () => {
            assert.equal(isSameSecret('', undefined), false);
            assert.equal(isSameSecret('secret', undefined), false);
        });
    });
});
