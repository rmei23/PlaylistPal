const express = require('express'); // To build an application server or API
const app = express();
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part B.

app.get('/', (req, res) => {
    res.redirect('/home');
});

app.get('/home', (req, res) => {
    res.render('pages/home.html');
});

app.get('/input', (req, res) => {
    res.render('pages/input.html');
});

app.get('/result', (req, res) => {
    res.render('pages/result.html');
});

app.get('/about', (req, res) => {
    res.render('pages/about.html');
});

app.listen(3000);
console.log('Server is listening on port 3000');