const mockModule = (modulePath, exports) => {
    const resolvedPath = require.resolve(modulePath);
    require.cache[resolvedPath] = {
        id: resolvedPath,
        filename: resolvedPath,
        loaded: true,
        exports,
    };
};

module.exports = { mockModule };
