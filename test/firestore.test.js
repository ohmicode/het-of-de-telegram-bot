const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

const createFakeFirestore = () => {
    const state = {
        queryResults: [],
        queries: [],
        documents: new Map(),
        updates: [],
        added: [],
        transactions: 0,
    };

    const createDocRef = (collectionName, docId) => {
        const key = `${collectionName}/${docId}`;
        return {
            key,
            get: async () => ({ exists: state.documents.has(key), data: () => state.documents.get(key) }),
            set: async (data) => state.documents.set(key, data),
            update: async (data) => state.updates.push({ key, data }),
        };
    };

    const snapshotOf = (collectionName, items) => ({
        empty: items.length === 0,
        docs: items.map((item, index) => ({ data: () => item, ref: createDocRef(collectionName, `doc-${index}`) })),
    });

    const createQuery = (collectionName) => {
        const query = { collection: collectionName, where: [], orderBy: null, limit: null };
        state.queries.push(query);
        const builder = {
            where: (field, op, value) => {
                query.where.push([field, op, value]);
                return builder;
            },
            orderBy: (field) => {
                query.orderBy = field;
                return builder;
            },
            limit: (count) => {
                query.limit = count;
                return builder;
            },
            get: async () => snapshotOf(collectionName, state.queryResults.shift() ?? []),
        };
        return builder;
    };

    const createTransaction = () => {
        let hasWrites = false;
        return {
            get: async (refOrQuery) => {
                if (hasWrites) {
                    throw new Error('Firestore transactions require all reads to be executed before all writes');
                }
                return refOrQuery.get();
            },
            update: (ref, data) => {
                hasWrites = true;
                state.updates.push({ key: ref.key, data });
            },
        };
    };

    class Firestore {
        constructor(options) {
            state.options = options;
        }

        collection(collectionName) {
            return {
                ...createQuery(collectionName),
                doc: (docId) => createDocRef(collectionName, docId),
                add: async (data) => state.added.push({ collection: collectionName, data }),
            };
        }

        async runTransaction(updateFunction) {
            state.transactions += 1;
            return updateFunction(createTransaction());
        }
    }

    return { Firestore, state };
};

const fake = createFakeFirestore();
mockModule('@google-cloud/firestore', { Firestore: fake.Firestore });
const firestore = require(path.join(__dirname, '../src/firestore'));

const lastQuery = () => fake.state.queries.at(-1);

const dictionaryQueried = () => fake.state.queries.some(({ collection }) => collection === 'dictionary');

describe('firestore', () => {
    beforeEach(() => {
        fake.state.queryResults = [];
        fake.state.queries = [];
        fake.state.documents.clear();
        fake.state.updates = [];
        fake.state.added = [];
        fake.state.transactions = 0;
    });

    it('uses the het-of-de-bot database', () => {
        assert.deepEqual(fake.state.options, { databaseId: 'het-of-de-bot' });
    });

    describe('getChats', () => {
        it('returns an empty list when no chats are subscribed', async () => {
            assert.deepEqual(await firestore.getChats(), []);
            assert.deepEqual(lastQuery().where, [['subscribed', '!=', null]]);
        });

        it('returns chat data of all found chats', async () => {
            fake.state.queryResults.push([{ id: 1 }, { id: 2 }]);
            assert.deepEqual(await firestore.getChats(), [{ id: 1 }, { id: 2 }]);
        });
    });

    describe('getWord', () => {
        it('returns the first word with random_key above a random value', async () => {
            fake.state.queryResults.push([{ id: 7 }]);

            assert.deepEqual(await firestore.getWord(), { id: 7 });
            assert.equal(fake.state.queries.length, 1);
            const [field, op, value] = lastQuery().where[0];
            assert.equal(field, 'random_key');
            assert.equal(op, '>=');
            assert.ok(value >= 0 && value < 1);
            assert.equal(lastQuery().limit, 1);
        });

        it('falls back to the first word ordered by random_key', async () => {
            fake.state.queryResults.push([], [{ id: 1 }]);

            assert.deepEqual(await firestore.getWord(), { id: 1 });
            assert.equal(fake.state.queries.length, 2);
            assert.equal(lastQuery().orderBy, 'random_key');
            assert.equal(lastQuery().limit, 1);
        });
    });

    describe('getWordById', () => {
        it('queries the dictionary by numeric id', async () => {
            const word = { id: 42, explanation: 'rule' };
            fake.state.queryResults.push([word]);

            assert.deepEqual(await firestore.getWordById('42'), word);
            assert.equal(lastQuery().collection, 'dictionary');
            assert.deepEqual(lastQuery().where, [['id', '==', 42]]);
            assert.equal(lastQuery().limit, 1);
        });

        it('returns null when the word does not exist', async () => {
            assert.equal(await firestore.getWordById('404'), null);
        });

        it('queries NaN for a non-numeric id and returns null', async () => {
            assert.equal(await firestore.getWordById('abc'), null);
            assert.ok(Number.isNaN(lastQuery().where[0][2]));
        });
    });

    describe('findOrCreateChat', () => {
        it('creates a chat when it does not exist', async () => {
            await firestore.findOrCreateChat(123, 'Anna');

            const chat = fake.state.documents.get('chats/123');
            assert.equal(chat.id, 123);
            assert.equal(chat.name, 'Anna');
            assert.ok(chat.created instanceof Date);
            assert.equal(chat.subscribed, null);
            assert.equal(chat.unsubscribed, null);
        });

        it('does not overwrite an existing chat', async () => {
            const existing = { id: 123, name: 'Old' };
            fake.state.documents.set('chats/123', existing);

            await firestore.findOrCreateChat(123, 'New');

            assert.equal(fake.state.documents.get('chats/123'), existing);
        });
    });

    describe('subscribe', () => {
        it('sets subscribed timestamp and clears unsubscribed', async () => {
            await firestore.subscribe(5);

            const [{ key, data }] = fake.state.updates;
            assert.equal(key, 'chats/5');
            assert.ok(data.subscribed instanceof Date);
            assert.equal(data.unsubscribed, null);
        });
    });

    describe('unsubscribe', () => {
        it('sets unsubscribed timestamp', async () => {
            await firestore.unsubscribe(5);

            const [{ key, data }] = fake.state.updates;
            assert.equal(key, 'chats/5');
            assert.ok(data.unsubscribed instanceof Date);
            assert.equal('subscribed' in data, false);
        });
    });

    describe('reportMistake', () => {
        it('adds a record to the mistakes collection', async () => {
            await firestore.reportMistake('42', 5, 'Anna');

            const [{ collection, data }] = fake.state.added;
            assert.equal(collection, 'mistakes');
            assert.equal(data.word_id, 42);
            assert.equal(data.chat_id, 5);
            assert.equal(data.name, 'Anna');
            assert.ok(data.reported instanceof Date);
        });

        it('stores the word id as a number, matching dictionary.id', async () => {
            await firestore.reportMistake('7', 5, 'Anna');

            assert.equal(typeof fake.state.added[0].data.word_id, 'number');
        });

        it('keeps a numeric word id unchanged', async () => {
            await firestore.reportMistake(42, 5, 'Anna');

            assert.equal(fake.state.added[0].data.word_id, 42);
        });
    });

    describe('savePoll', () => {
        it('stores the word and the correct option of a poll with empty counts', async () => {
            await firestore.savePoll('poll-1', 42, 1);

            const poll = fake.state.documents.get('polls/poll-1');
            assert.equal(poll.word_id, 42);
            assert.equal(poll.correct_option_id, 1);
            assert.deepEqual(poll.counts, { correct: 0, incorrect: 0 });
            assert.ok(poll.created instanceof Date);
        });

        it('expires the poll 30 days after creation', async () => {
            await firestore.savePoll('poll-1', 42, 1);

            const { created, expires } = fake.state.documents.get('polls/poll-1');
            assert.ok(expires instanceof Date);
            assert.equal(expires.getTime() - created.getTime(), 30 * 24 * 60 * 60 * 1000);
        });

        it('stores the word id as a number, matching dictionary.id', async () => {
            await firestore.savePoll('poll-1', '42', 1);

            assert.equal(fake.state.documents.get('polls/poll-1').word_id, 42);
        });

        it('stores no chat or user data', async () => {
            await firestore.savePoll('poll-1', 42, 1);

            assert.deepEqual(
                Object.keys(fake.state.documents.get('polls/poll-1')).sort(),
                ['correct_option_id', 'counts', 'created', 'expires', 'word_id'],
            );
        });
    });

    describe('recordPollAnswers', () => {
        const pollUpdate = (deVotes, hetVotes) => ({
            id: 'poll-1',
            options: [
                { text: 'de boek', voter_count: deVotes },
                { text: 'het boek', voter_count: hetVotes },
            ],
        });

        const storePoll = (counts = { correct: 0, incorrect: 0 }) => fake.state.documents.set('polls/poll-1', {
            word_id: 42,
            correct_option_id: 1,
            counts,
        });

        it('adds new answers to the word statistics and the poll counts', async () => {
            storePoll({ correct: 2, incorrect: 1 });
            fake.state.queryResults.push([{ id: 42, statistics: { correct: 10, incorrect: 4 } }]);

            assert.equal(await firestore.recordPollAnswers(pollUpdate(2, 3)), true);

            assert.equal(fake.state.transactions, 1);
            assert.equal(lastQuery().collection, 'dictionary');
            assert.deepEqual(lastQuery().where, [['id', '==', 42]]);
            assert.equal(lastQuery().limit, 1);
            assert.deepEqual(fake.state.updates, [
                { key: 'dictionary/doc-0', data: { statistics: { correct: 11, incorrect: 5 }, difficulty: 5 / 16 } },
                { key: 'polls/poll-1', data: { counts: { correct: 3, incorrect: 2 } } },
            ]);
        });

        it('keeps difficulty null while the word has 10 answers or fewer', async () => {
            storePoll();
            fake.state.queryResults.push([{ id: 42, statistics: { correct: 0, incorrect: 0 } }]);

            await firestore.recordPollAnswers(pollUpdate(1, 0));

            assert.deepEqual(fake.state.updates[0].data, { statistics: { correct: 0, incorrect: 1 }, difficulty: null });
        });

        it('starts from zero when the word has no statistics', async () => {
            storePoll();
            fake.state.queryResults.push([{ id: 42 }]);

            await firestore.recordPollAnswers(pollUpdate(0, 1));

            assert.deepEqual(fake.state.updates[0].data.statistics, { correct: 1, incorrect: 0 });
        });

        it('ignores an unknown or expired poll', async () => {
            assert.equal(await firestore.recordPollAnswers(pollUpdate(0, 1)), false);

            assert.equal(dictionaryQueried(), false);
            assert.deepEqual(fake.state.updates, []);
        });

        it('ignores a repeated update without reading the word', async () => {
            storePoll({ correct: 1, incorrect: 0 });

            assert.equal(await firestore.recordPollAnswers(pollUpdate(0, 1)), false);

            assert.equal(dictionaryQueried(), false);
            assert.deepEqual(fake.state.updates, []);
        });

        it('ignores an older update with lower counts', async () => {
            storePoll({ correct: 3, incorrect: 2 });

            assert.equal(await firestore.recordPollAnswers(pollUpdate(1, 2)), false);

            assert.deepEqual(fake.state.updates, []);
        });

        it('ignores a poll whose word no longer exists', async () => {
            storePoll();

            assert.equal(await firestore.recordPollAnswers(pollUpdate(0, 1)), false);

            assert.deepEqual(fake.state.updates, []);
        });
    });
});
