const fastify = require('fastify')({
    logger: true
});

const {
    getChats,
    getWord,
    getWordById,
    findOrCreateChat,
    subscribe,
    unsubscribe,
    reportMistake,
    savePoll,
    recordPollAnswers,
} = require('./firestore');
const { loadBotToken, sendMessage, sendQuiz, answerCallbackQuery } = require('./telegram');
const { isActiveSubscriber, sendQuizzes } = require('./scheduler');
const { loadWebhookSecret, verifyTelegramRequest } = require('./webhook-auth');
const { parseCommandName, parseCallbackData, isWordId } = require('./commands');
const { describeUpdate, truncateLongStrings } = require('./update-log');

const HELP_MESSAGE = `
Welcome to "De of Het" bot!
This bot helps you learn Dutch articles ("de" or "het") by providing interactive quizzes. You can also subscribe to receive a daily quiz.

Commands:
/word - Get a new quiz with a random word.
/subscribe - Subscribe to receive a daily quiz.
/unsubscribe - Unsubscribe from the daily quiz.
/help - Show this help message.

You can also use the buttons to interact with the bot.
`;

const NO_EXPLANATION_MESSAGE = 'rule unknown - just memorize it';
const WORD_NOT_FOUND_MESSAGE = 'Sorry, this word was not found.';
const ERROR_MESSAGE = 'Sorry, something went wrong. Please try again later.';

const formatExplanation = (word) => `${word.article} ${word.dutch}\n${word.explanation || NO_EXPLANATION_MESSAGE}`;

const MAIN_KEYBOARD = {
    inline_keyboard: [
        [
            { text: 'Get a word', callback_data: '/word' },
            { text: 'Subscribe', callback_data: '/subscribe' },
            { text: 'Unsubscribe', callback_data: '/unsubscribe' },
        ],
    ],
};

const sendTrackedQuiz = async (chatId, word) => {
    const { pollId, correctOptionId } = await sendQuiz(chatId, word);
    try {
        await savePoll(pollId, word.id, correctOptionId);
    } catch (error) {
        fastify.log.error({ err: error, pollId, wordId: word.id }, 'Failed to save a poll for statistics');
    }
};

const sendHelp = (chatId) => sendMessage(chatId, HELP_MESSAGE, MAIN_KEYBOARD);

const COMMANDS = {
    '/start': sendHelp,
    '/help': sendHelp,
    '/word': async (chatId) => sendTrackedQuiz(chatId, await getWord()),
    '/subscribe': async (chatId) => {
        await subscribe(chatId);
        await sendMessage(chatId, 'You have been subscribed for a daily quiz!');
    },
    '/unsubscribe': async (chatId) => {
        await unsubscribe(chatId);
        await sendMessage(chatId, 'You have been unsubscribed from the daily quiz.');
    },
};

const resolveName = (chat, from) =>
    chat.first_name || chat.username || from?.first_name || from?.username || chat.title || null;

const findCommand = (name) => (Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined);

const handleMessage = async (message) => {
    const chatId = message.chat.id;
    await findOrCreateChat(chatId, resolveName(message.chat, message.from));

    const command = message.text && findCommand(parseCommandName(message.text));
    if (command) {
        await command(chatId);
    }
};

const handleCallbackQuery = async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const chatName = resolveName(callbackQuery.message.chat, callbackQuery.from);
    const { command: commandName, wordId } = parseCallbackData(callbackQuery.data);
    const command = findCommand(commandName);

    await Promise.all([
        answerCallbackQuery(callbackQuery.id),
        findOrCreateChat(chatId, chatName),
    ]);

    if (command) {
        await command(chatId);
    } else if (wordId === undefined) {
        return;
    } else if (commandName === '/report_bug') {
        await reportMistake(wordId, chatId, chatName);
        await sendMessage(chatId, 'Thanks for the heads-up!');
    } else if (commandName === '/explain') {
        const word = await getWordById(wordId);
        await sendMessage(chatId, word ? formatExplanation(word) : WORD_NOT_FOUND_MESSAGE);
    }
};

const handleUpdate = async ({ message, callback_query, poll }) => {
    if (message) {
        await handleMessage(message);
    }
    if (callback_query) {
        await handleCallbackQuery(callback_query);
    }
    if (poll) {
        await recordPollAnswers(poll);
    }
};

const isRecognizedMessage = (message) =>
    Boolean(message?.chat) && typeof message.text === 'string' && findCommand(parseCommandName(message.text)) !== undefined;

const isRecognizedCallbackQuery = (callbackQuery) => {
    if (!callbackQuery?.message?.chat || typeof callbackQuery.data !== 'string') {
        return false;
    }
    const { command, wordId } = parseCallbackData(callbackQuery.data);
    return wordId === undefined ? findCommand(command) !== undefined : isWordId(wordId);
};

const isRecognizedPoll = (poll) => typeof poll?.id === 'string';

const isRecognizedUpdate = (update) =>
    isRecognizedMessage(update?.message) || isRecognizedCallbackQuery(update?.callback_query) || isRecognizedPoll(update?.poll);

const logUpdate = (update, log) => {
    if (isRecognizedUpdate(update)) {
        log.info(describeUpdate(update), 'Telegram update');
    } else {
        log.info({ update: truncateLongStrings(update) }, 'Unrecognized Telegram update');
    }
};

const getUpdateChatId = (update) => update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;

const notifyAboutError = async (chatId, log) => {
    try {
        await sendMessage(chatId, ERROR_MESSAGE);
    } catch (error) {
        log.error({ chatId, err: error }, 'Failed to notify the chat about an error');
    }
};

fastify.post('/webhook', { onRequest: verifyTelegramRequest }, async (request, reply) => {
    logUpdate(request.body, request.log);
    try {
        await handleUpdate(request.body);
    } catch (error) {
        request.log.error({ err: error, updateId: request.body?.update_id }, 'Failed to handle a Telegram update');
        const chatId = getUpdateChatId(request.body);
        if (chatId) {
            await notifyAboutError(chatId, request.log);
        }
    }

    reply.send({ ok: true });
});

fastify.get('/scheduler', async (request, reply) => {
    try {
        const subscribers = (await getChats()).filter(isActiveSubscriber);
        if (subscribers.length === 0) {
            reply.send({ ok: true, chats: 0 });
            return;
        }

        const word = await getWord();
        const { sent, failures } = await sendQuizzes(
            subscribers.map(chat => chat.id),
            chatId => sendTrackedQuiz(chatId, word),
        );

        failures.forEach(({ chatId, error }) => fastify.log.warn({ chatId, err: error }, 'Failed to send a quiz'));
        reply.send({ ok: true, chats: subscribers.length, sent, failed: failures.length });
    } catch (error) {
        fastify.log.error(error);
        reply.status(500).send({ ok: false, error: 'Failed to send quizzes' });
    }
});


const start = async () => {
    try {
        await Promise.all([loadBotToken(), loadWebhookSecret()]);
        await fastify.listen({ port: process.env.PORT || 8080, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
