const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { isActiveSubscriber, sendQuizzes } = require(path.join(__dirname, '../src/scheduler'));

const recordingSleep = () => {
    const sleeps = [];
    const sleep = async (ms) => {
        sleeps.push(ms);
    };
    return { sleeps, sleep };
};

describe('scheduler', () => {
    describe('isActiveSubscriber', () => {
        it('accepts a subscribed chat', () => {
            assert.equal(isActiveSubscriber({ subscribed: new Date(), unsubscribed: null }), true);
        });

        it('rejects a chat that unsubscribed', () => {
            assert.equal(isActiveSubscriber({ subscribed: new Date(), unsubscribed: new Date() }), false);
        });

        it('rejects a chat that never subscribed', () => {
            assert.equal(isActiveSubscriber({ subscribed: null, unsubscribed: null }), false);
        });
    });

    describe('sendQuizzes', () => {
        it('does nothing for an empty chat list', async () => {
            const { sleeps, sleep } = recordingSleep();
            const sent = [];

            const result = await sendQuizzes([], async (chatId) => sent.push(chatId), { sleep });

            assert.deepEqual(result, { sent: 0, failures: [] });
            assert.deepEqual(sent, []);
            assert.deepEqual(sleeps, []);
        });

        it('sends a quiz to every chat', async () => {
            const sent = [];

            const result = await sendQuizzes([1, 2, 3], async (chatId) => sent.push(chatId));

            assert.deepEqual(result, { sent: 3, failures: [] });
            assert.deepEqual(sent, [1, 2, 3]);
        });

        it('keeps sending after a failure and reports the failed chats', async () => {
            const error = new Error('Forbidden: bot was blocked by the user');
            const sent = [];
            const sendQuiz = async (chatId) => {
                if (chatId === 2) {
                    throw error;
                }
                sent.push(chatId);
            };

            const result = await sendQuizzes([1, 2, 3, 4], sendQuiz, { batchSize: 2, sleep: async () => {} });

            assert.deepEqual(result, { sent: 3, failures: [{ chatId: 2, error }] });
            assert.deepEqual(sent, [1, 3, 4]);
        });

        it('reports every chat as failed when all sends fail', async () => {
            const error = new Error('boom');

            const result = await sendQuizzes([1, 2], async () => {
                throw error;
            });

            assert.deepEqual(result, { sent: 0, failures: [{ chatId: 1, error }, { chatId: 2, error }] });
        });

        it('sends a batch in parallel', async () => {
            const started = [];
            let releaseBatch;
            const batchReleased = new Promise(resolve => {
                releaseBatch = resolve;
            });
            const sendQuiz = async (chatId) => {
                started.push(chatId);
                await batchReleased;
            };

            const sending = sendQuizzes([1, 2, 3], sendQuiz, { batchSize: 3 });
            await Promise.resolve();

            assert.deepEqual(started, [1, 2, 3]);
            releaseBatch();
            assert.deepEqual(await sending, { sent: 3, failures: [] });
        });

        it('pauses between batches but not after the last one', async () => {
            const { sleeps, sleep } = recordingSleep();
            const sent = [];

            await sendQuizzes([1, 2, 3, 4, 5], async (chatId) => sent.push(chatId), {
                batchSize: 2,
                batchIntervalMs: 1000,
                sleep,
            });

            assert.deepEqual(sent, [1, 2, 3, 4, 5]);
            assert.equal(sleeps.length, 2);
            assert.ok(sleeps.every(ms => ms > 900 && ms <= 1000));
        });

        it('does not pause when a batch takes longer than the interval', async () => {
            const { sleeps, sleep } = recordingSleep();
            const slowSend = () => new Promise(resolve => setTimeout(resolve, 20));

            await sendQuizzes([1, 2], slowSend, { batchSize: 1, batchIntervalMs: 5, sleep });

            assert.deepEqual(sleeps, [0]);
        });
    });
});
