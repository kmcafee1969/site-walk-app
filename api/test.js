module.exports = (req, res) => {
    res.status(200).json({
        message: 'CommonJS API Working',
        time: new Date().toISOString(),
        node: process.version
    });
};
