const { Firestore } = require('@google-cloud/firestore');
const {
    NO_ANSWERS,
    countPollAnswers,
    countNewAnswers,
    hasAnswers,
    addAnswers,
    calculateDifficulty,
} = require('./statistics');

const POLL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const firestore = new Firestore({
    databaseId: 'het-of-de-bot',
});

const getChats = async () => {
    const chatsSnapshot = await firestore.collection('chats').where('subscribed', '!=', null).get();
    if (chatsSnapshot.empty) {
        return [];
    }
    return chatsSnapshot.docs.map(doc => doc.data());
}

const getWord = async () => {
    const random = Math.random();
    let wordSnapshot = await firestore.collection('dictionary')
        .where('random_key', '>=', random)
        .limit(1).get();

    if (wordSnapshot.empty) {
        wordSnapshot = await firestore.collection('dictionary')
            .orderBy('random_key')
            .limit(1).get();
    }
    return wordSnapshot.docs[0].data();
}

const getWordById = async (wordId) => {
    const wordSnapshot = await firestore.collection('dictionary')
        .where('id', '==', Number(wordId))
        .limit(1).get();

    if (wordSnapshot.empty) {
        return null;
    }
    return wordSnapshot.docs[0].data();
}

const findOrCreateChat = async (chatId, name) => {
    const chatRef = firestore.collection('chats').doc(chatId.toString());
    const chatSnapshot = await chatRef.get();

    if (!chatSnapshot.exists) {
        await chatRef.set({
            id: chatId,
            name: name,
            created: new Date(),
            subscribed: null,
            unsubscribed: null,
        });
    }
    return chatRef;
}

const subscribe = async (chatId) => {
    const chatRef = firestore.collection('chats').doc(chatId.toString());
    await chatRef.update({
        subscribed: new Date(),
        unsubscribed: null,
    });
}

const unsubscribe = async (chatId) => {
    const chatRef = firestore.collection('chats').doc(chatId.toString());
    await chatRef.update({
        unsubscribed: new Date(),
    });
}


const reportMistake = async (wordId, chatId, userName) => {
    await firestore.collection('mistakes').add({
        word_id: Number(wordId),
        chat_id: chatId,
        name: userName,
        reported: new Date(),
    });
};

const savePoll = async (pollId, wordId, correctOptionId) => {
    const created = new Date();
    await firestore.collection('polls').doc(pollId).set({
        word_id: Number(wordId),
        correct_option_id: correctOptionId,
        counts: { ...NO_ANSWERS },
        created,
        expires: new Date(created.getTime() + POLL_RETENTION_MS),
    });
};

const recordPollAnswers = async (poll) => firestore.runTransaction(async (transaction) => {
    const pollRef = firestore.collection('polls').doc(poll.id);
    const pollSnapshot = await transaction.get(pollRef);
    if (!pollSnapshot.exists) {
        return false;
    }

    const { word_id, correct_option_id, counts } = pollSnapshot.data();
    const newAnswers = countNewAnswers(counts, countPollAnswers(poll.options, correct_option_id));
    if (!hasAnswers(newAnswers)) {
        return false;
    }

    const wordSnapshot = await transaction.get(firestore.collection('dictionary')
        .where('id', '==', word_id)
        .limit(1));
    if (wordSnapshot.empty) {
        return false;
    }

    const wordDocument = wordSnapshot.docs[0];
    const statistics = addAnswers(wordDocument.data().statistics ?? NO_ANSWERS, newAnswers);
    transaction.update(wordDocument.ref, { statistics, difficulty: calculateDifficulty(statistics) });
    transaction.update(pollRef, { counts: addAnswers(counts, newAnswers) });
    return true;
});

module.exports = {
    getChats,
    getWord,
    getWordById,
    findOrCreateChat,
    subscribe,
    unsubscribe,
    reportMistake,
    savePoll,
    recordPollAnswers,
};
