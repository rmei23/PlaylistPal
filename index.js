const express = require('express'); // To build an application server or API
const path = require('path');
const app = express();

const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part B.
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(express.static(path.join(__dirname, 'public')));


app.set('views', __dirname + '/public/views');

app.get('/', (req, res) => {
    res.redirect('/home');
});

app.get('/home', (req, res) => {
    res.render('home.html');
});

app.get('/input', (req, res) => {
    res.render('input.html');
});

app.get('/result', (req, res) => {
    res.render('result.html');
});

app.get('/about', (req, res) => {
    res.render('about.html');
});

app.listen(3000);
console.log('Server is listening on port 3000');