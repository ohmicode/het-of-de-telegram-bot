const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    NO_ANSWERS,
    countPollAnswers,
    countNewAnswers,
    hasAnswers,
    addAnswers,
    calculateDifficulty,
} = require(path.join(__dirname, '../src/statistics'));

const pollOptions = (deVotes, hetVotes) => [
    { text: 'de boek', voter_count: deVotes },
    { text: 'het boek', voter_count: hetVotes },
];

describe('statistics', () => {
    describe('countPollAnswers', () => {
        it('counts votes for the correct option as correct and the rest as incorrect', () => {
            assert.deepEqual(countPollAnswers(pollOptions(2, 5), 1), { correct: 5, incorrect: 2 });
            assert.deepEqual(countPollAnswers(pollOptions(2, 5), 0), { correct: 2, incorrect: 5 });
        });

        it('returns no answers for a poll without votes', () => {
            assert.deepEqual(countPollAnswers(pollOptions(0, 0), 1), NO_ANSWERS);
        });

        it('returns no answers when options are missing', () => {
            assert.deepEqual(countPollAnswers(undefined, 1), NO_ANSWERS);
        });

        it('treats a missing voter count as zero', () => {
            assert.deepEqual(countPollAnswers([{ text: 'de boek' }, { text: 'het boek', voter_count: 3 }], 0), {
                correct: 0,
                incorrect: 3,
            });
        });
    });

    describe('countNewAnswers', () => {
        it('counts all answers of the first update', () => {
            assert.deepEqual(countNewAnswers(NO_ANSWERS, { correct: 1, incorrect: 0 }), { correct: 1, incorrect: 0 });
        });

        it('counts only answers added since the recorded counts', () => {
            assert.deepEqual(
                countNewAnswers({ correct: 3, incorrect: 1 }, { correct: 4, incorrect: 3 }),
                { correct: 1, incorrect: 2 },
            );
        });

        it('counts nothing for a repeated update', () => {
            assert.deepEqual(countNewAnswers({ correct: 3, incorrect: 1 }, { correct: 3, incorrect: 1 }), NO_ANSWERS);
        });

        it('counts nothing for an older update with lower counts', () => {
            assert.deepEqual(countNewAnswers({ correct: 3, incorrect: 1 }, { correct: 2, incorrect: 0 }), NO_ANSWERS);
        });

        it('counts only the grown side when the other one is behind', () => {
            assert.deepEqual(
                countNewAnswers({ correct: 3, incorrect: 1 }, { correct: 2, incorrect: 4 }),
                { correct: 0, incorrect: 3 },
            );
        });
    });

    describe('hasAnswers', () => {
        it('is false without answers', () => {
            assert.equal(hasAnswers(NO_ANSWERS), false);
        });

        it('is true with correct or incorrect answers', () => {
            assert.equal(hasAnswers({ correct: 1, incorrect: 0 }), true);
            assert.equal(hasAnswers({ correct: 0, incorrect: 1 }), true);
        });
    });

    describe('addAnswers', () => {
        it('adds correct and incorrect answers separately', () => {
            assert.deepEqual(
                addAnswers({ correct: 3, incorrect: 1 }, { correct: 1, incorrect: 2 }),
                { correct: 4, incorrect: 3 },
            );
        });
    });

    describe('calculateDifficulty', () => {
        it('is null without answers', () => {
            assert.equal(calculateDifficulty(NO_ANSWERS), null);
        });

        it('is null with exactly 10 answers', () => {
            assert.equal(calculateDifficulty({ correct: 5, incorrect: 5 }), null);
        });

        it('is the share of incorrect answers with more than 10 answers', () => {
            assert.equal(calculateDifficulty({ correct: 8, incorrect: 3 }), 3 / 11);
        });

        it('is 0 when all answers are correct', () => {
            assert.equal(calculateDifficulty({ correct: 11, incorrect: 0 }), 0);
        });

        it('is 1 when all answers are incorrect', () => {
            assert.equal(calculateDifficulty({ correct: 0, incorrect: 11 }), 1);
        });
    });
});
