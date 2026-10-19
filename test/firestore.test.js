const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mockModule } = require('./helpers/mock-module');

const snapshotOf = (items) => ({
    empty: items.length === 0,
    docs: items.map(item => ({ data: () => item })),
});

const createFakeFirestore = () => {
    const state = {
        queryResults: [],
        queries: [],
        documents: new Map(),
        updates: [],
        added: [],
    };

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
            get: async () => snapshotOf(state.queryResults.shift() ?? []),
        };
        return builder;
    };

    const createDocRef = (collectionName, docId) => {
        const key = `${collectionName}/${docId}`;
        return {
            get: async () => ({ exists: state.documents.has(key), data: () => state.documents.get(key) }),
            set: async (data) => state.documents.set(key, data),
            update: async (data) => state.updates.push({ key, data }),
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
    }

    return { Firestore, state };
};

const fake = createFakeFirestore();
mockModule('@google-cloud/firestore', { Firestore: fake.Firestore });
const firestore = require(path.join(__dirname, '../src/firestore'));

const lastQuery = () => fake.state.queries.at(-1);

describe('firestore', () => {
    beforeEach(() => {
        fake.state.queryResults = [];
        fake.state.queries = [];
        fake.state.documents.clear();
        fake.state.updates = [];
        fake.state.added = [];
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
            assert.equal(data.word_id, '42');
            assert.equal(data.chat_id, 5);
            assert.equal(data.name, 'Anna');
            assert.ok(data.reported instanceof Date);
        });
    });
});
