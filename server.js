const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Force the server to read the real Miruro scraping script
const scraper = require('./index.js');

// 1. The Main Catalog UI Route
app.get('/feed', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        // Runs the live discovery loop to pull full collections instantly
        const data = await scraper.discoveryHome();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: "Failed to parse streaming feeds", details: error.message });
    }
});

// 2. The Uptime Health Validation Route
app.get('/health', (req, res) => {
    res.status(200).json({ status: "healthy", module: "Miruro Engine Core" });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
