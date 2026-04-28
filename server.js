const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3005;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Send index.html for any request (optional, good for SPAs)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Frontend server running on http://0.0.0.0:${PORT}`);
    console.log(`To access on other devices, use your computer's IP address.`);
});
