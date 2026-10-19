const MIN_ANSWERS_FOR_DIFFICULTY = 10;

const NO_ANSWERS = Object.freeze({ correct: 0, incorrect: 0 });

const countPollAnswers = (options = [], correctOptionId) => {
    const total = options.reduce((sum, option) => sum + (option.voter_count ?? 0), 0);
    const correct = options[correctOptionId]?.voter_count ?? 0;
    return { correct, incorrect: total - correct };
};

const countNewAnswers = (recorded, current) => ({
    correct: Math.max(0, current.correct - recorded.correct),
    incorrect: Math.max(0, current.incorrect - recorded.incorrect),
});

const hasAnswers = ({ correct, incorrect }) => correct + incorrect > 0;

const addAnswers = (first, second) => ({
    correct: first.correct + second.correct,
    incorrect: first.incorrect + second.incorrect,
});

const calculateDifficulty = ({ correct, incorrect }) => {
    const total = correct + incorrect;
    return total > MIN_ANSWERS_FOR_DIFFICULTY ? incorrect / total : null;
};

module.exports = {
    NO_ANSWERS,
    countPollAnswers,
    countNewAnswers,
    hasAnswers,
    addAnswers,
    calculateDifficulty,
};
