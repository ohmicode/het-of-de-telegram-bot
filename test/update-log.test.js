const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { describeUpdate, truncateLongStrings } = require(path.join(__dirname, '../src/update-log'));

const withoutUndefined = (value) => JSON.parse(JSON.stringify(value));

const privateChat = { id: 10, type: 'private', first_name: 'Anna', username: 'anna_nl' };
const sender = { id: 555, first_name: 'Bram', username: 'bram_nl' };

describe('update-log', () => {
    describe('describeUpdate', () => {
        it('describes a message command without personal data or arguments', () => {
            const description = describeUpdate({
                update_id: 1,
                message: { message_id: 3, chat: privateChat, from: sender, text: '/WORD@het_of_de_artikelen_bot secret text' },
            });

            assert.deepEqual(withoutUndefined(description), {
                updateId: 1,
                type: 'message',
                chatId: 10,
                chatType: 'private',
                command: '/word',
            });
        });

        it('describes a callback query command with the word id as a number', () => {
            const description = describeUpdate({
                update_id: 2,
                callback_query: {
                    id: 'cb-1',
                    from: sender,
                    data: '/explain_42',
                    message: { chat: { id: -100, type: 'group', title: 'Dutch class' } },
                },
            });

            assert.deepEqual(description, {
                updateId: 2,
                type: 'callback_query',
                callbackQueryId: 'cb-1',
                chatId: -100,
                chatType: 'group',
                command: '/explain',
                wordId: 42,
            });
        });

        it('describes a callback query command without a word id', () => {
            const description = describeUpdate({
                update_id: 2,
                callback_query: { id: 'cb-1', data: '/subscribe', message: { chat: privateChat } },
            });

            assert.equal(description.command, '/subscribe');
            assert.equal(description.wordId, undefined);
        });

        it('describes the poll id and the votes per option', () => {
            const description = describeUpdate({
                update_id: 3,
                poll: {
                    id: 'poll-1',
                    question: '"the book".',
                    options: [{ text: 'de boek', voter_count: 1 }, { text: 'het boek', voter_count: 4 }],
                },
            });

            assert.deepEqual(description, { updateId: 3, type: 'poll', pollId: 'poll-1', votes: [1, 4] });
        });

        it('describes a poll without options', () => {
            assert.equal(describeUpdate({ update_id: 3, poll: { id: 'poll-1' } }).votes, undefined);
        });
    });

    describe('truncateLongStrings', () => {
        const text = (length) => 'a'.repeat(length);

        it('keeps strings up to 200 characters', () => {
            assert.equal(truncateLongStrings(text(200)), text(200));
            assert.equal(truncateLongStrings(''), '');
        });

        it('trims strings longer than 200 characters to the first 200', () => {
            assert.equal(truncateLongStrings(`${text(200)}b`), text(200));
        });

        it('trims strings in nested objects and arrays', () => {
            const update = {
                update_id: 1,
                message: { chat: { id: 10, first_name: text(300) }, text: text(5000), entities: [{ url: text(201) }, text(250)] },
            };

            assert.deepEqual(truncateLongStrings(update), {
                update_id: 1,
                message: { chat: { id: 10, first_name: text(200) }, text: text(200), entities: [{ url: text(200) }, text(200)] },
            });
        });

        it('keeps numbers, booleans and null', () => {
            assert.deepEqual(
                truncateLongStrings({ id: 12345678901234567890, is_bot: false, data: null, values: [0, true] }),
                { id: 12345678901234567890, is_bot: false, data: null, values: [0, true] },
            );
        });

        it('keeps a missing body', () => {
            assert.equal(truncateLongStrings(undefined), undefined);
        });

        it('does not change the original update', () => {
            const update = { message: { text: text(300) } };

            truncateLongStrings(update);

            assert.equal(update.message.text.length, 300);
        });

        it('replaces values nested deeper than 20 levels with a placeholder', () => {
            const deeplyNested = Array.from({ length: 1000 }).reduce(nested => ({ nested }), 'end');

            const truncated = truncateLongStrings(deeplyNested);

            const depthOf = (value) => (typeof value === 'object' ? 1 + depthOf(value.nested) : 0);
            assert.equal(depthOf(truncated), 20);
            const innermost = Array.from({ length: 20 }).reduce(value => value.nested, truncated);
            assert.equal(innermost, '[too deep]');
        });
    });
});
