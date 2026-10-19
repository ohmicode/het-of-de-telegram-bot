const { timingSafeEqual } = require('node:crypto');
const { readSecret } = require('./secrets');

const WEBHOOK_SECRET_NAME = 'het-of-de-webhook-secret';
const SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token';

let webhookSecret;

const loadWebhookSecret = async () => {
    webhookSecret = await readSecret(WEBHOOK_SECRET_NAME);
};

const isSameSecret = (received, expected) => {
    if (typeof received !== 'string' || !expected) {
        return false;
    }
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(expected);
    return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
};

const verifyTelegramRequest = async (request, reply) => {
    if (!isSameSecret(request.headers[SECRET_TOKEN_HEADER], webhookSecret)) {
        request.log.warn('Rejected a webhook request with a missing or invalid secret token');
        return reply.code(401).send({ ok: false });
    }
};

module.exports = {
    isSameSecret,
    loadWebhookSecret,
    verifyTelegramRequest,
};
