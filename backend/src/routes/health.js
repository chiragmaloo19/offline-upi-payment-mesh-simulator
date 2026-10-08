const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

router.get('/health', (req, res) => {
    const dbStatus = {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    };
    res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        database: dbStatus
    });
});

module.exports = router;
