const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

let botToken;

const getBotToken = async () => {
    if (botToken) {
        return botToken;
    }
    const secretManager = new SecretManagerServiceClient();
    const projectId = await secretManager.getProjectId();
    console.log(`projectId = ${projectId}`);
    const [version] = await secretManager.accessSecretVersion({
        name: `projects/${projectId}/secrets/het-of-de-token/versions/latest`,
    });
    botToken = version.payload.data.toString();
    return botToken;
};

const callTelegramApi = async (method, payload) => {
    const token = await getBotToken();
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
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
    // console.log(`callbackQueryId = ${callbackQueryId}`);
    return callTelegramApi('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
    });
};

module.exports = {
    sendMessage,
    sendQuiz,
    answerCallbackQuery,
};
