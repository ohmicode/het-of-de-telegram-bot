const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

let secretManager;

const getSecretManager = () => {
    secretManager ??= new SecretManagerServiceClient();
    return secretManager;
};

const readSecret = async (secretName) => {
    const client = getSecretManager();
    const projectId = await client.getProjectId();
    const [version] = await client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });
    return version.payload.data.toString().trim();
};

module.exports = { readSecret };
