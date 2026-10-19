const { parseCommandName, parseCallbackData } = require('./commands');

const MAX_LOGGED_STRING_LENGTH = 200;
const MAX_LOGGED_DEPTH = 20;
const TOO_DEEP_PLACEHOLDER = '[too deep]';

const describeChat = (chat) => ({ chatId: chat.id, chatType: chat.type });

const describeMessage = (message) => ({
    ...describeChat(message.chat),
    command: parseCommandName(message.text),
});

const describeCallbackQuery = (callbackQuery) => {
    const { command, wordId } = parseCallbackData(callbackQuery.data);
    return {
        callbackQueryId: callbackQuery.id,
        ...describeChat(callbackQuery.message.chat),
        command,
        wordId: wordId === undefined ? undefined : Number(wordId),
    };
};

const describePoll = (poll) => ({
    pollId: poll.id,
    votes: poll.options?.map(option => option.voter_count),
});

const UPDATE_DESCRIBERS = {
    message: describeMessage,
    callback_query: describeCallbackQuery,
    poll: describePoll,
};

const describeUpdate = (update) => {
    const type = Object.keys(UPDATE_DESCRIBERS).find(key => update[key]);
    return {
        updateId: update.update_id,
        type,
        ...UPDATE_DESCRIBERS[type](update[type]),
    };
};

const truncateLongStrings = (value, depth = 0) => {
    if (typeof value === 'string') {
        return value.slice(0, MAX_LOGGED_STRING_LENGTH);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (depth >= MAX_LOGGED_DEPTH) {
        return TOO_DEEP_PLACEHOLDER;
    }
    if (Array.isArray(value)) {
        return value.map(item => truncateLongStrings(item, depth + 1));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateLongStrings(item, depth + 1)]));
};

module.exports = {
    describeUpdate,
    truncateLongStrings,
};
