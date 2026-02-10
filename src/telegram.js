const axios = require('axios');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

let botToken;

const getBotToken = async () => {
    if (botToken) {
        return botToken;
    }
    const secretManager = new SecretManagerServiceClient();
    const projectId = await secretManager.getProjectId();
    const [version] = await secretManager.accessSecretVersion({
        name: `projects/${projectId}/secrets/het-of-de-token/versions/latest`,
    });
    botToken = version.payload.data.toString();
    return botToken;
};

const getTelegramApi = async () => {
    const token = await getBotToken();
    return axios.create({
        baseURL: `https://api.telegram.org/bot${token}`,
    });
};

const sendMessage = async (chatId, text, reply_markup = undefined) => {
    const telegramApi = await getTelegramApi();
    const payload = {
        chat_id: chatId,
        text,
    };
    if (reply_markup) {
        payload.reply_markup = reply_markup;
    }
    return telegramApi.post('/sendMessage', payload);
};

const sendQuiz = async (chatId, word) => {
    const telegramApi = await getTelegramApi();

    const question = `What is the correct article for "${word.dutch}"?`;
    const options = [`de ${word.dutch}`, `het ${word.dutch}`];
    const correctOptionId = word.article === 'de' ? 0 : 1;

    await telegramApi.post('/sendPoll', {
        chat_id: chatId,
        question,
        options: JSON.stringify(options),
        type: 'quiz',
        correct_option_id: correctOptionId,
    });

    return sendMessage(chatId, '​', {
        inline_keyboard: [
            [{ text: 'Next word', callback_data: '/word' }]
        ]
    });
};

const answerCallbackQuery = async (callbackQueryId) => {
    const telegramApi = await getTelegramApi();
    return telegramApi.post('/answerCallbackQuery', {
        callback_query_id: callbackQueryId,
    });
};

module.exports = {
    sendMessage,
    sendQuiz,
    answerCallbackQuery,
};
