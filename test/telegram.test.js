const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

const state = { posts: [], axiosConfigs: [], secretRequests: [] };

mockModule('axios', {
    create: (config) => {
        state.axiosConfigs.push(config);
        return { post: async (url, payload) => state.posts.push({ url, payload }) };
    },
});

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
    beforeEach(() => {
        state.posts = [];
        state.axiosConfigs = [];
    });

    it('reads the bot token from Secret Manager only once', async () => {
        await telegram.sendMessage(1, 'first');
        await telegram.sendMessage(1, 'second');

        assert.deepEqual(state.secretRequests, [
            { name: 'projects/test-project/secrets/het-of-de-token/versions/latest' },
        ]);
        assert.ok(state.axiosConfigs.every(config => config.baseURL === 'https://api.telegram.org/bottest-token'));
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
