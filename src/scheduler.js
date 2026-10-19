const { wait } = require('./wait');

const QUIZZES_PER_BATCH = 15;
const BATCH_INTERVAL_MS = 1000;

const splitIntoBatches = (items, batchSize) => Array.from(
    { length: Math.ceil(items.length / batchSize) },
    (_, index) => items.slice(index * batchSize, (index + 1) * batchSize),
);

const isActiveSubscriber = (chat) => Boolean(chat.subscribed) && !chat.unsubscribed;

const sendBatch = async (chatIds, sendQuiz) => {
    const results = await Promise.allSettled(chatIds.map(sendQuiz));
    return results.flatMap((result, index) => result.status === 'rejected'
        ? [{ chatId: chatIds[index], error: result.reason }]
        : []);
};

const sendQuizzes = async (chatIds, sendQuiz, {
    batchSize = QUIZZES_PER_BATCH,
    batchIntervalMs = BATCH_INTERVAL_MS,
    sleep = wait,
} = {}) => {
    const batches = splitIntoBatches(chatIds, batchSize);
    const failures = [];

    for (const [index, batch] of batches.entries()) {
        const startedAt = Date.now();
        failures.push(...await sendBatch(batch, sendQuiz));

        const isLastBatch = index === batches.length - 1;
        if (!isLastBatch) {
            await sleep(Math.max(0, batchIntervalMs - (Date.now() - startedAt)));
        }
    }

    return { sent: chatIds.length - failures.length, failures };
};

module.exports = {
    isActiveSubscriber,
    sendQuizzes,
};
