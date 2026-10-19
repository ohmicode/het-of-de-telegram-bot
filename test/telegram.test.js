const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

const TELEGRAM_BOT_URL = 'https://api.telegram.org/bottest-token';

const state = { posts: [], requests: [], secretRequests: [], responses: [], response: null };

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const fakeFetch = async (url, options) => {
    state.requests.push({ url, options });
    state.posts.push({ url: url.replace(TELEGRAM_BOT_URL, ''), payload: JSON.parse(options.body) });
    return state.responses.shift() ?? state.response ?? jsonResponse({ ok: true, result: {} });
};

mockModule('@google-cloud/secret-manager', {
    SecretManagerServiceClient: class {
        async getProjectId() {
            return 'test-project';
        }

        async accessSecretVersion(request) {
            state.secretRequests.push(request);
            return [{ payload: { data: Buffer.from('test-token') } }];
        }
    },
});

const telegram = require(path.join(__dirname, '../src/telegram'));

const word = { id: 42, english: 'the book', example: 'I read the book.', dutch: 'boek', article: 'het' };

describe('telegram', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        state.posts = [];
        state.requests = [];
        state.responses = [];
        state.response = null;
        globalThis.fetch = fakeFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('refuses to call Telegram before the bot token is loaded', async () => {
        await assert.rejects(telegram.sendMessage(1, 'hello'), /Bot token is not loaded/);
        assert.deepEqual(state.requests, []);
    });

    it('reads the bot token from Secret Manager only once', async () => {
        await telegram.loadBotToken();
        await telegram.sendMessage(1, 'first');
        await telegram.sendMessage(1, 'second');

        assert.deepEqual(state.secretRequests, [
            { name: 'projects/test-project/secrets/het-of-de-token/versions/latest' },
        ]);
        assert.ok(state.requests.every(({ url }) => url.startsWith(`${TELEGRAM_BOT_URL}/`)));
    });

    describe('Telegram API calls', () => {
        it('posts JSON to the bot method URL', async () => {
            await telegram.sendMessage(1, 'hello');

            const [{ url, options }] = state.requests;
            assert.equal(url, `${TELEGRAM_BOT_URL}/sendMessage`);
            assert.equal(options.method, 'POST');
            assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
        });

        it('returns the parsed Telegram response', async () => {
            state.response = jsonResponse({ ok: true, result: { message_id: 7 } });

            assert.deepEqual(await telegram.sendMessage(1, 'hello'), { ok: true, result: { message_id: 7 } });
        });

        it('throws on a non-2xx response without exposing the token', async () => {
            state.response = jsonResponse({ ok: false, description: 'Bad Request: chat not found' }, 400);

            await assert.rejects(telegram.sendMessage(1, 'hello'), (error) => {
                assert.match(error.message, /Telegram API sendMessage failed with status 400/);
                assert.match(error.message, /chat not found/);
                assert.doesNotMatch(error.message, /test-token/);
                return true;
            });
        });

        it('does not send the follow-up message when the poll fails', async () => {
            state.response = jsonResponse({ ok: false }, 500);

            await assert.rejects(telegram.sendQuiz(1, word));
            assert.deepEqual(state.posts.map(({ url }) => url), ['/sendPoll']);
        });

        it('retries after the rate limit delay on 429', async () => {
            state.responses = [
                jsonResponse({ ok: false, parameters: { retry_after: 0 } }, 429),
                jsonResponse({ ok: true, result: { message_id: 7 } }),
            ];

            assert.deepEqual(await telegram.sendMessage(1, 'hello'), { ok: true, result: { message_id: 7 } });
            assert.equal(state.requests.length, 2);
        });

        it('gives up after 3 rate limit retries', async () => {
            state.responses = Array.from({ length: 4 }, () =>
                jsonResponse({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 0 } }, 429));

            await assert.rejects(telegram.sendMessage(1, 'hello'), /failed with status 429: .*Too Many Requests/);
            assert.equal(state.requests.length, 4);
        });

        it('propagates network errors', async () => {
            globalThis.fetch = async () => {
                throw new TypeError('fetch failed');
            };

            await assert.rejects(telegram.answerCallbackQuery('cb-1'), /fetch failed/);
        });
    });

    describe('sendMessage', () => {
        it('sends a text message without reply markup', async () => {
            await telegram.sendMessage(1, 'hello');

            assert.deepEqual(state.posts, [{ url: '/sendMessage', payload: { chat_id: 1, text: 'hello' } }]);
        });

        it('sends a text message with reply markup', async () => {
            const markup = { inline_keyboard: [] };
            await telegram.sendMessage(1, 'hello', markup);

            assert.deepEqual(state.posts[0].payload, { chat_id: 1, text: 'hello', reply_markup: markup });
        });
    });

    describe('sendQuiz', () => {
        it('sends a quiz poll with de/het options', async () => {
            await telegram.sendQuiz(1, word);

            assert.deepEqual(state.posts[0], {
                url: '/sendPoll',
                payload: {
                    chat_id: 1,
                    question: '"the book".\n(I read the book.)',
                    options: JSON.stringify(['de boek', 'het boek']),
                    type: 'quiz',
                    correct_option_id: 1,
                },
            });
        });

        it('marks the "de" option as correct for de-words', async () => {
            await telegram.sendQuiz(1, { ...word, article: 'de' });

            assert.equal(state.posts[0].payload.correct_option_id, 0);
        });

        it('sends follow-up buttons in order: Explain, Report a bug, Next word', async () => {
            await telegram.sendQuiz(1, word);

            assert.deepEqual(state.posts[1], {
                url: '/sendMessage',
                payload: {
                    chat_id: 1,
                    text: 'Do you want to learn more?',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Explain', callback_data: '/explain_42' }],
                            [{ text: 'Report a bug', callback_data: '/report_bug_42' }],
                            [{ text: 'Next word', callback_data: '/word' }],
                        ],
                    },
                },
            });
        });
    });

    describe('answerCallbackQuery', () => {
        it('answers the callback query', async () => {
            await telegram.answerCallbackQuery('cb-1');

            assert.deepEqual(state.posts, [{ url: '/answerCallbackQuery', payload: { callback_query_id: 'cb-1' } }]);
        });
    });
});
