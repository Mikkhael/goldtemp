//@ts-check
const express = require('express');
const app = express();



const PORT = process.env.PORT || 5000;



app.get('/', (req, res) => {
    const ip = req.ip;
    const hostname = req.hostname;
    res.send(`Hello ${hostname}@${ip}`);
    res.end();
});

app.listen(PORT, () => {
    console.log("App listening on port: ", PORT);
});