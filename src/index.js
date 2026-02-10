const fastify = require('fastify')({
    logger: true
});

const { getChats, getWord, findOrCreateChat, subscribe, unsubscribe } = require('./firestore');
const { sendMessage, sendQuiz, answerCallbackQuery } = require('./telegram');

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

fastify.post('/webhook', async (request, reply) => {
    const { message, callback_query } = request.body;

    if (message) {
        const chatId = message.chat.id;
        const chatName = message.chat.first_name || message.chat.username;
        await findOrCreateChat(chatId, chatName);

        if (message.text) {
            const text = message.text.trim();

            if (text.startsWith('/start')) {
                await sendMessage(chatId, HELP_MESSAGE, {
                    inline_keyboard: [
                        [
                            { text: 'Get a word', callback_data: '/word' },
                            { text: 'Subscribe', callback_data: '/subscribe' },
                            { text: 'Unsubscribe', callback_data: '/unsubscribe' },
                        ],
                    ]
                });
            } else if (text.startsWith('/help')) {
                await sendMessage(chatId, HELP_MESSAGE, {
                    inline_keyboard: [
                        [
                            { text: 'Get a word', callback_data: '/word' },
                            { text: 'Subscribe', callback_data: '/subscribe' },
                            { text: 'Unsubscribe', callback_data: '/unsubscribe' },
                        ],
                    ]
                });
            }
        }
    }

    if (callback_query) {
        const chatId = callback_query.message.chat.id;
        const data = callback_query.data;

        await answerCallbackQuery(callback_query.id);

        if (data === '/word') {
            const word = await getWord();
            await sendQuiz(chatId, word);
        } else if (data === '/subscribe') {
            await subscribe(chatId);
            await sendMessage(chatId, 'You have been subscribed for a daily quiz!');
        } else if (data === '/unsubscribe') {
            await unsubscribe(chatId);
            await sendMessage(chatId, 'You have been unsubscribed from the daily quiz.');
        }
    }

    reply.send({ ok: true });
});

fastify.get('/scheduler', async (request, reply) => {
    try {
        const chats = await getChats();
        if (chats.length === 0) {
            reply.send({ ok: true, chats: 0 });
            return;
        }

        const word = await getWord();

        for (const chat of chats) {
            if (chat.subscribed && !chat.unsubscribed) {
                await sendQuiz(chat.id, word);
            }
        }
        reply.send({ ok: true, chats: chats.length });
    } catch (error) {
        fastify.log.error(error);
        reply.status(500).send({ ok: false, error: 'Failed to send quizzes' });
    }
});


const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 8080, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
