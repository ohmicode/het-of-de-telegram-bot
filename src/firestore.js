const { Firestore } = require('@google-cloud/firestore');

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


module.exports = {
    getChats,
    getWord,
    findOrCreateChat,
    subscribe,
    unsubscribe,
};
