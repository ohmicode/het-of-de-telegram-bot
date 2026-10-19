const fastify = require('fastify')({
    logger: true
});

const { getChats, getWord, getWordById, findOrCreateChat, subscribe, unsubscribe, reportMistake } = require('./firestore');
const { loadBotToken, sendMessage, sendQuiz, answerCallbackQuery } = require('./telegram');
const { isActiveSubscriber, sendQuizzes } = require('./scheduler');

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

const sendHelp = (chatId) => sendMessage(chatId, HELP_MESSAGE, MAIN_KEYBOARD);

const COMMANDS = {
    '/start': sendHelp,
    '/help': sendHelp,
    '/word': async (chatId) => sendQuiz(chatId, await getWord()),
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

const parseCommandName = (text) => text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

fastify.post('/webhook', async (request, reply) => {
    const { message, callback_query } = request.body;

    if (message) {
        const chatId = message.chat.id;
        const chatName = resolveName(message.chat, message.from);
        await findOrCreateChat(chatId, chatName);

        const command = message.text && findCommand(parseCommandName(message.text));
        if (command) {
            await command(chatId);
        }
    }

    if (callback_query) {
        const chatId = callback_query.message.chat.id;
        const data = callback_query.data;
        const command = findCommand(data);

        await answerCallbackQuery(callback_query.id);

        if (command) {
            await command(chatId);
        } else if (data.startsWith('/report_bug_')) {
            const wordId = data.replace('/report_bug_', '');
            const chatName = resolveName(callback_query.message.chat, callback_query.from);
            await reportMistake(wordId, chatId, chatName);
            await sendMessage(chatId, 'Thanks for the heads-up!');
        } else if (data.startsWith('/explain_')) {
            const wordId = data.replace('/explain_', '');
            const word = await getWordById(wordId);
            await sendMessage(chatId, word ? formatExplanation(word) : WORD_NOT_FOUND_MESSAGE);
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
            chatId => sendQuiz(chatId, word),
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
        await loadBotToken();
        await fastify.listen({ port: process.env.PORT || 8080, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
