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

const postWebhook = (body) => app.inject({ method: 'POST', url: '/webhook', payload: body });

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
    let startupCallNames;

    before(async () => {
        await app.ready();
        startupCallNames = calls.map(([name]) => name);
    });
    after(() => app.close());

    beforeEach(() => {
        calls.length = 0;
        Object.keys(stubs).forEach(key => delete stubs[key]);
    });

    describe('startup', () => {
        it('loads the bot token before listening for requests', () => {
            assert.deepEqual(startupCallNames, ['loadBotToken', 'listen']);
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

        it('does not register a chat for callback queries', async () => {
            await postWebhook(callbackQuery('/explain_42'));

            assert.deepEqual(callsOf('findOrCreateChat'), []);
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
