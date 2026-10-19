const { readSecret } = require('./secrets');
const { wait } = require('./wait');

const TOO_MANY_REQUESTS = 429;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 1;

let botToken;

const loadBotToken = async () => {
    botToken = await readSecret('het-of-de-token');
};

const getRetryAfterMs = async (response) => {
    const body = await response.json().catch(() => ({}));
    return (body.parameters?.retry_after ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000;
};

const callTelegramApi = async (method, payload, retry = 0) => {
    if (!botToken) {
        throw new Error('Bot token is not loaded, call loadBotToken() on startup');
    }
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (response.status === TOO_MANY_REQUESTS && retry < MAX_RATE_LIMIT_RETRIES) {
        await wait(await getRetryAfterMs(response));
        return callTelegramApi(method, payload, retry + 1);
    }
    if (!response.ok) {
        throw new Error(`Telegram API ${method} failed with status ${response.status}: ${await response.text()}`);
    }
    return response.json();
};

const sendMessage = async (chatId, text, reply_markup = undefined) => {
    const payload = {
        chat_id: chatId,
        text,
    };
    if (reply_markup) {
        payload.reply_markup = reply_markup;
    }
    return callTelegramApi('sendMessage', payload);
};

const sendQuiz = async (chatId, word) => {
    const question = `"${word.english}".\n(${word.example})`;
    const options = [`de ${word.dutch}`, `het ${word.dutch}`];
    const correctOptionId = word.article === 'de' ? 0 : 1;

    await callTelegramApi('sendPoll', {
        chat_id: chatId,
        question,
        options: JSON.stringify(options),
        type: 'quiz',
        correct_option_id: correctOptionId,
    });

    return sendMessage(chatId, 'Do you want to learn more?', {
        inline_keyboard: [
            [{ text: 'Explain', callback_data: `/explain_${word.id}` }],
            [{ text: 'Report a bug', callback_data: `/report_bug_${word.id}` }],
            [{ text: 'Next word', callback_data: '/word' }]
        ]
    });
};

const answerCallbackQuery = async (callbackQueryId) => {
    return callTelegramApi('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
    });
};

module.exports = {
    loadBotToken,
    sendMessage,
    sendQuiz,
    answerCallbackQuery,
};
