const WORD_COMMAND_PATTERN = /^(\/(?:explain|report_bug))_(.*)$/;
const WORD_ID_PATTERN = /^\d+$/;

const parseCommandName = (text) => text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

const parseCallbackData = (data = '') => {
    const match = WORD_COMMAND_PATTERN.exec(data);
    return match ? { command: match[1], wordId: match[2] } : { command: data };
};

const isWordId = (wordId) => WORD_ID_PATTERN.test(wordId ?? '');

module.exports = {
    parseCommandName,
    parseCallbackData,
    isWordId,
};
