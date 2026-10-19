const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

const calls = [];
const stubs = {};
const record = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    return stubs[name] ? stubs[name](...args) : result;
};

mockModule(path.join(__dirname, '../src/firestore'), {
    getChats: record('getChats', []),
    getWord: record('getWord'),
    getWordById: record('getWordById', null),
    findOrCreateChat: record('findOrCreateChat'),
    subscribe: record('subscribe'),
    unsubscribe: record('unsubscribe'),
    reportMistake: record('reportMistake'),
});

const WEBHOOK_SECRET = 'test-webhook-secret';

mockModule(path.join(__dirname, '../src/secrets'), {
    readSecret: record('readSecret', WEBHOOK_SECRET),
});

mockModule(path.join(__dirname, '../src/telegram'), {
    loadBotToken: record('loadBotToken'),
    sendMessage: record('sendMessage'),
    sendQuiz: record('sendQuiz'),
    answerCallbackQuery: record('answerCallbackQuery'),
});

let app;
const realFastify = require('fastify');
mockModule('fastify', (options) => {
    app = realFastify({ ...options, logger: false });
    app.listen = record('listen');
    return app;
});

require(path.join(__dirname, '../src/index'));

const callsOf = (name) => calls.filter(([callName]) => callName === name).map(([, ...args]) => args);

const SECRET_HEADER = { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET };

const postWebhook = (body, headers = SECRET_HEADER) => app.inject({ method: 'POST', url: '/webhook', payload: body, headers });

const callbackQuery = (data, chat = { id: 10, first_name: 'Anna' }) => ({
    callback_query: { id: 'cb-1', data, message: { chat } },
});

const textMessage = (text, chat = { id: 10, first_name: 'Anna' }) => ({ message: { chat, text } });

const MAIN_KEYBOARD = {
    inline_keyboard: [
        [
            { text: 'Get a word', callback_data: '/word' },
            { text: 'Subscribe', callback_data: '/subscribe' },
            { text: 'Unsubscribe', callback_data: '/unsubscribe' },
        ],
    ],
};

describe('index', () => {
    let startupCalls;
    let startupCallNames;

    before(async () => {
        await app.ready();
        startupCalls = [...calls];
        startupCallNames = calls.map(([name]) => name);
    });
    after(() => app.close());

    beforeEach(() => {
        calls.length = 0;
        Object.keys(stubs).forEach(key => delete stubs[key]);
    });

    describe('startup', () => {
        it('loads the bot token before listening for requests', () => {
            assert.deepEqual(startupCallNames, ['loadBotToken', 'readSecret', 'listen']);
        });

        it('loads the webhook secret from Secret Manager', () => {
            assert.ok(startupCalls.some(([name, secretName]) => name === 'readSecret' && secretName === 'het-of-de-webhook-secret'));
        });
    });

    describe('POST /webhook messages', () => {
        it('registers the chat using first name', async () => {
            const response = await postWebhook(textMessage('hi'));

            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.json(), { ok: true });
            assert.deepEqual(callsOf('findOrCreateChat'), [[10, 'Anna']]);
            assert.deepEqual(callsOf('sendMessage'), []);
        });

        it('falls back to username when first name is missing', async () => {
            await postWebhook(textMessage('hi', { id: 11, username: 'anna_nl' }));

            assert.deepEqual(callsOf('findOrCreateChat'), [[11, 'anna_nl']]);
        });

        describe('group chats', () => {
            const groupChat = { id: -100, type: 'group', title: 'Dutch class' };
            const groupMessage = (from) => ({ message: { chat: groupChat, from, text: 'hi' } });

            it('takes the name from the sender first name', async () => {
                await postWebhook(groupMessage({ id: 5, first_name: 'Bram', username: 'bram_nl' }));

                assert.deepEqual(callsOf('findOrCreateChat'), [[-100, 'Bram']]);
            });

            it('falls back to the sender username', async () => {
                await postWebhook(groupMessage({ id: 5, username: 'bram_nl' }));

                assert.deepEqual(callsOf('findOrCreateChat'), [[-100, 'bram_nl']]);
            });

            it('falls back to the chat title when the sender has no name', async () => {
                await postWebhook(groupMessage({ id: 5 }));

                assert.deepEqual(callsOf('findOrCreateChat'), [[-100, 'Dutch class']]);
            });

            it('falls back to the chat title when there is no sender', async () => {
                await postWebhook(groupMessage(undefined));

                assert.deepEqual(callsOf('findOrCreateChat'), [[-100, 'Dutch class']]);
            });
        });

        it('prefers the private chat name over the sender name', async () => {
            await postWebhook({ message: { chat: { id: 10, first_name: 'Anna' }, from: { id: 10, first_name: 'Other' }, text: 'hi' } });

            assert.deepEqual(callsOf('findOrCreateChat'), [[10, 'Anna']]);
        });

        it('stores null instead of undefined when no name is available', async () => {
            await postWebhook({ message: { chat: { id: 12 }, text: 'hi' } });

            assert.deepEqual(callsOf('findOrCreateChat'), [[12, null]]);
        });

        it('registers the chat for messages without text', async () => {
            await postWebhook({ message: { chat: { id: 10, first_name: 'Anna' } } });

            assert.deepEqual(callsOf('findOrCreateChat'), [[10, 'Anna']]);
            assert.deepEqual(callsOf('sendMessage'), []);
        });

        for (const command of ['/start', '/help', '  /help  ']) {
            it(`sends help with the main keyboard on "${command}"`, async () => {
                await postWebhook(textMessage(command));

                const [[chatId, text, markup]] = callsOf('sendMessage');
                assert.equal(chatId, 10);
                assert.match(text, /Welcome to "De of Het" bot!/);
                assert.deepEqual(markup, MAIN_KEYBOARD);
            });
        }

        it('sends a quiz on typed /word', async () => {
            const word = { id: 1 };
            stubs.getWord = () => word;

            await postWebhook(textMessage('/word'));

            assert.deepEqual(callsOf('sendQuiz'), [[10, word]]);
        });

        it('subscribes on typed /subscribe after registering the chat', async () => {
            await postWebhook(textMessage('/subscribe'));

            assert.deepEqual(calls.map(([name]) => name), ['findOrCreateChat', 'subscribe', 'sendMessage']);
            assert.deepEqual(callsOf('subscribe'), [[10]]);
            assert.deepEqual(callsOf('sendMessage'), [[10, 'You have been subscribed for a daily quiz!']]);
        });

        it('unsubscribes on typed /unsubscribe', async () => {
            await postWebhook(textMessage('/unsubscribe'));

            assert.deepEqual(callsOf('unsubscribe'), [[10]]);
            assert.deepEqual(callsOf('sendMessage'), [[10, 'You have been unsubscribed from the daily quiz.']]);
        });

        it('accepts a command addressed to the bot by name, as in group chats', async () => {
            await postWebhook(textMessage('/subscribe@het_of_de_artikelen_bot'));

            assert.deepEqual(callsOf('subscribe'), [[10]]);
        });

        it('ignores arguments and letter case of a command', async () => {
            await postWebhook(textMessage('/WORD please'));

            assert.equal(callsOf('sendQuiz').length, 1);
        });

        for (const text of ['/helpme', 'word', 'hello /word', '/constructor', '/explain_1', '/report_bug_1']) {
            it(`ignores "${text}"`, async () => {
                await postWebhook(textMessage(text));

                assert.deepEqual(calls.map(([name]) => name), ['findOrCreateChat']);
            });
        }
    });

    describe('POST /webhook callback queries', () => {
        it('answers every callback query', async () => {
            await postWebhook(callbackQuery('/unknown'));

            assert.deepEqual(callsOf('answerCallbackQuery'), [['cb-1']]);
            assert.deepEqual(callsOf('sendMessage'), []);
        });

        it('sends a quiz on /word', async () => {
            const word = { id: 1 };
            stubs.getWord = () => word;

            await postWebhook(callbackQuery('/word'));

            assert.deepEqual(callsOf('sendQuiz'), [[10, word]]);
        });

        it('subscribes on /subscribe', async () => {
            await postWebhook(callbackQuery('/subscribe'));

            assert.deepEqual(callsOf('subscribe'), [[10]]);
            assert.deepEqual(callsOf('sendMessage'), [[10, 'You have been subscribed for a daily quiz!']]);
        });

        it('unsubscribes on /unsubscribe', async () => {
            await postWebhook(callbackQuery('/unsubscribe'));

            assert.deepEqual(callsOf('unsubscribe'), [[10]]);
            assert.deepEqual(callsOf('sendMessage'), [[10, 'You have been unsubscribed from the daily quiz.']]);
        });

        it('reports a mistake on /report_bug_<id>', async () => {
            await postWebhook(callbackQuery('/report_bug_42'));

            assert.deepEqual(callsOf('reportMistake'), [['42', 10, 'Anna']]);
            assert.deepEqual(callsOf('sendMessage'), [[10, 'Thanks for the heads-up!']]);
        });

        it('reports a mistake with username when first name is missing', async () => {
            await postWebhook(callbackQuery('/report_bug_42', { id: 11, username: 'anna_nl' }));

            assert.deepEqual(callsOf('reportMistake'), [['42', 11, 'anna_nl']]);
        });

        it('reports a mistake in a group chat with the name of the user who pressed the button', async () => {
            await postWebhook({
                callback_query: {
                    id: 'cb-1',
                    data: '/report_bug_42',
                    from: { id: 5, first_name: 'Bram' },
                    message: { chat: { id: -100, type: 'group', title: 'Dutch class' }, from: { id: 1, first_name: 'Bot', is_bot: true } },
                },
            });

            assert.deepEqual(callsOf('reportMistake'), [['42', -100, 'Bram']]);
        });
    });

    describe('POST /webhook explain', () => {
        it('sends the word explanation on /explain_<id>', async () => {
            stubs.getWordById = () => ({
                id: 42,
                article: 'het',
                dutch: 'begin',
                explanation: "het - words derived from verbs, beginning with 'be-' or 'ge-'",
            });

            await postWebhook(callbackQuery('/explain_42'));

            assert.deepEqual(callsOf('getWordById'), [['42']]);
            assert.deepEqual(callsOf('sendMessage'), [
                [10, "het begin\nhet - words derived from verbs, beginning with 'be-' or 'ge-'"],
            ]);
        });

        it('sends a default explanation when the word has none', async () => {
            stubs.getWordById = () => ({ id: 42, article: 'de', dutch: 'tafel' });

            await postWebhook(callbackQuery('/explain_42'));

            assert.deepEqual(callsOf('sendMessage'), [[10, 'de tafel\nrule unknown - just memorize it']]);
        });

        it('sends a default explanation when the explanation is empty', async () => {
            stubs.getWordById = () => ({ id: 42, article: 'de', dutch: 'tafel', explanation: '' });

            await postWebhook(callbackQuery('/explain_42'));

            assert.deepEqual(callsOf('sendMessage'), [[10, 'de tafel\nrule unknown - just memorize it']]);
        });

        it('sends a not found message when the word does not exist', async () => {
            await postWebhook(callbackQuery('/explain_404'));

            assert.deepEqual(callsOf('getWordById'), [['404']]);
            assert.deepEqual(callsOf('sendMessage'), [[10, 'Sorry, this word was not found.']]);
        });

        it('registers the chat for callback queries', async () => {
            await postWebhook(callbackQuery('/explain_42'));

            assert.deepEqual(callsOf('findOrCreateChat'), [[10, 'Anna']]);
        });
    });

    describe('POST /webhook authentication', () => {
        const rejectedHeaders = {
            'no secret token header': {},
            'a wrong secret token': { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
            'a secret token with a different length': { 'X-Telegram-Bot-Api-Secret-Token': `${WEBHOOK_SECRET}x` },
            'an empty secret token': { 'X-Telegram-Bot-Api-Secret-Token': '' },
        };

        for (const [description, headers] of Object.entries(rejectedHeaders)) {
            it(`rejects a request with ${description}`, async () => {
                const response = await postWebhook(textMessage('/word'), headers);

                assert.equal(response.statusCode, 401);
                assert.deepEqual(response.json(), { ok: false });
                assert.deepEqual(calls, []);
            });
        }

        it('accepts a request with the right secret token', async () => {
            const response = await postWebhook(textMessage('/help'));

            assert.equal(response.statusCode, 200);
            assert.equal(callsOf('sendMessage').length, 1);
        });

        it('does not require the secret token for /scheduler', async () => {
            const response = await app.inject({ method: 'GET', url: '/scheduler' });

            assert.equal(response.statusCode, 200);
        });
    });

    describe('POST /webhook error handling', () => {
        const ERROR_MESSAGE = 'Sorry, something went wrong. Please try again later.';
        const failWith = (message) => () => {
            throw new Error(message);
        };

        it('registers the chat before subscribing from a button', async () => {
            await postWebhook(callbackQuery('/subscribe'));

            const names = calls.map(([name]) => name);
            assert.ok(names.indexOf('findOrCreateChat') < names.indexOf('subscribe'));
        });

        it('responds 200 and notifies the chat when a message handler fails', async () => {
            stubs.getWord = failWith('Firestore unavailable');

            const response = await postWebhook(textMessage('/word'));

            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.json(), { ok: true });
            assert.deepEqual(callsOf('sendMessage'), [[10, ERROR_MESSAGE]]);
        });

        it('responds 200 and notifies the chat when a callback query handler fails', async () => {
            stubs.subscribe = failWith('5 NOT_FOUND: No document to update');

            const response = await postWebhook(callbackQuery('/subscribe'));

            assert.equal(response.statusCode, 200);
            assert.deepEqual(callsOf('sendMessage'), [[10, ERROR_MESSAGE]]);
        });

        it('responds 200 when registering the chat fails', async () => {
            stubs.findOrCreateChat = failWith('Cannot use undefined as a Firestore value');

            const response = await postWebhook(textMessage('/help'));

            assert.equal(response.statusCode, 200);
            assert.deepEqual(callsOf('sendMessage'), [[10, ERROR_MESSAGE]]);
        });

        it('responds 200 when the error notification fails too', async () => {
            stubs.sendMessage = failWith('Forbidden: bot was blocked by the user');

            const response = await postWebhook(textMessage('/help'));

            assert.equal(response.statusCode, 200);
            assert.equal(callsOf('sendMessage').length, 2);
        });

        it('responds 200 without a notification for a malformed update', async () => {
            const response = await postWebhook({ callback_query: { id: 'cb-1', data: '/word' } });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(callsOf('sendMessage'), []);
        });

        it('responds 200 for a request without a body', async () => {
            const response = await app.inject({ method: 'POST', url: '/webhook', headers: SECRET_HEADER });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(calls, []);
        });

        it('responds 200 for an update type the bot does not handle', async () => {
            const response = await postWebhook({ update_id: 1, edited_message: { chat: { id: 10 } } });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(calls, []);
        });
    });

    describe('GET /scheduler', () => {
        it('returns zero chats when nobody is subscribed', async () => {
            const response = await app.inject({ method: 'GET', url: '/scheduler' });

            assert.deepEqual(response.json(), { ok: true, chats: 0 });
            assert.deepEqual(callsOf('getWord'), []);
        });

        it('sends the same quiz to subscribed chats only', async () => {
            const word = { id: 1 };
            stubs.getWord = () => word;
            stubs.getChats = () => [
                { id: 1, subscribed: new Date(), unsubscribed: null },
                { id: 2, subscribed: new Date(), unsubscribed: new Date() },
                { id: 3, subscribed: new Date(), unsubscribed: null },
            ];

            const response = await app.inject({ method: 'GET', url: '/scheduler' });

            assert.deepEqual(response.json(), { ok: true, chats: 2, sent: 2, failed: 0 });
            assert.equal(callsOf('getWord').length, 1);
            assert.deepEqual(callsOf('sendQuiz'), [[1, word], [3, word]]);
        });

        it('does not pick a word when all chats unsubscribed', async () => {
            stubs.getChats = () => [{ id: 1, subscribed: new Date(), unsubscribed: new Date() }];

            const response = await app.inject({ method: 'GET', url: '/scheduler' });

            assert.deepEqual(response.json(), { ok: true, chats: 0 });
            assert.deepEqual(callsOf('getWord'), []);
        });

        it('keeps sending when one chat fails and reports it without failing the request', async () => {
            stubs.getWord = () => ({ id: 1 });
            stubs.getChats = () => [
                { id: 1, subscribed: new Date(), unsubscribed: null },
                { id: 2, subscribed: new Date(), unsubscribed: null },
                { id: 3, subscribed: new Date(), unsubscribed: null },
            ];
            stubs.sendQuiz = (chatId) => {
                if (chatId === 2) {
                    throw new Error('Forbidden: bot was blocked by the user');
                }
            };

            const response = await app.inject({ method: 'GET', url: '/scheduler' });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.json(), { ok: true, chats: 3, sent: 2, failed: 1 });
            assert.deepEqual(callsOf('sendQuiz').map(([chatId]) => chatId), [1, 2, 3]);
        });

        it('returns 500 when sending fails', async () => {
            stubs.getChats = () => {
                throw new Error('boom');
            };

            const response = await app.inject({ method: 'GET', url: '/scheduler' });

            assert.equal(response.statusCode, 500);
            assert.deepEqual(response.json(), { ok: false, error: 'Failed to send quizzes' });
        });
    });
});
