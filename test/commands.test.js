const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseCommandName, parseCallbackData, isWordId } = require(path.join(__dirname, '../src/commands'));

describe('commands', () => {
    describe('parseCommandName', () => {
        it('returns the first word in lower case', () => {
            assert.equal(parseCommandName('  /WORD please '), '/word');
        });

        it('drops the bot name of a command addressed to the bot', () => {
            assert.equal(parseCommandName('/subscribe@het_of_de_artikelen_bot'), '/subscribe');
        });
    });

    describe('parseCallbackData', () => {
        it('returns a plain command without a word id', () => {
            assert.deepEqual(parseCallbackData('/word'), { command: '/word' });
        });

        it('splits /explain_<id> into the command and the word id', () => {
            assert.deepEqual(parseCallbackData('/explain_42'), { command: '/explain', wordId: '42' });
        });

        it('splits /report_bug_<id> into the command and the word id', () => {
            assert.deepEqual(parseCallbackData('/report_bug_7'), { command: '/report_bug', wordId: '7' });
        });

        it('keeps an empty word id', () => {
            assert.deepEqual(parseCallbackData('/explain_'), { command: '/explain', wordId: '' });
        });

        it('does not treat a word command without "_" as having a word id', () => {
            assert.deepEqual(parseCallbackData('/explain'), { command: '/explain' });
        });

        it('does not split other commands with "_"', () => {
            assert.deepEqual(parseCallbackData('/word_42'), { command: '/word_42' });
        });

        it('returns an empty command for missing data', () => {
            assert.deepEqual(parseCallbackData(undefined), { command: '' });
        });
    });

    describe('isWordId', () => {
        it('accepts digits only', () => {
            assert.equal(isWordId('42'), true);
        });

        for (const wordId of ['', 'abc', '4a', '-1', '1.5', ' 42', undefined]) {
            it(`rejects ${JSON.stringify(wordId)}`, () => {
                assert.equal(isWordId(wordId), false);
            });
        }
    });
});
