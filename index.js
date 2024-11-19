require('dotenv').config();

const express = require('express'); // To build an application server or API
const path = require('path');
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part B.
const querystring = require('querystring');
const session = require('express-session');
const spotifyHelpers = require('./src/helpers/helpers');

const app = express();

// Set up session middleware
app.use(session({
    secret: 'your_session_secret',  // Change this to a secure random string
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 1000 * 60 * 60 // 1 hour
    }
}));

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(express.static(path.join(__dirname, 'public')));

app.set('views', __dirname + '/public/views');

var client_id = process.env.CLIENT_ID;
var redirect_uri = 'http://localhost:3000/callback';

app.get('/', (req, res) => {
    // If user is already authenticated, go to home
    if (req.session.spotifyToken && Date.now() <= req.session.spotifyToken.expires_at) {
        res.redirect('/home');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', function(req, res) {
    // If user is already authenticated, redirect to home
    if (req.session.spotifyToken && Date.now() <= req.session.spotifyToken.expires_at) {
        return res.redirect('/home');
    }

    var state = spotifyHelpers.generateRandomString(16);
    var scope = 'user-read-private user-read-email';

    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state
        }));
});

app.get('/callback', async function(req, res) {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const error = req.query.error || null;

    if (error) {
        console.error('Error during authentication:', error);
        return res.redirect('/#' + 
            querystring.stringify({
                error: 'authorization_failed'
            }));
    }

    try {
        const data = await spotifyHelpers.getAccessToken(code, redirect_uri);
        
        // Store token information in session
        req.session.spotifyToken = {
            access_token: data.access_token,
            token_type: data.token_type,
            expires_in: data.expires_in,
            expires_at: Date.now() + (data.expires_in * 1000) // Calculate expiration time
        };

        // Redirect to home page
        res.redirect('/home');
    } catch (error) {
        console.error('Error in callback:', error);
        res.redirect('/#' + 
            querystring.stringify({
                error: 'invalid_token'
            }));
    }
});

// Add a middleware to check if user is authenticated
function requireSpotifyAuth(req, res, next) {
    if (!req.session.spotifyToken) {
        return res.redirect('/login');
    }
    
    // Check if token is expired
    if (Date.now() > req.session.spotifyToken.expires_at) {
        return res.redirect('/login');
    }
    
    next();
}

// Protect routes that need authentication
app.get('/home', (req, res) => {
    // Check authentication here instead
    if (!req.session.spotifyToken || Date.now() > req.session.spotifyToken.expires_at) {
        // If not authenticated, show login button or message in home.html
        res.render('home.html', { authenticated: false });
    } else {
        // If authenticated, show full functionality
        res.render('home.html', { authenticated: true });
    }
});

app.get('/input', requireSpotifyAuth, (req, res) => {
    res.render('input.html');
});

app.get('/result', requireSpotifyAuth, (req, res) => {
    res.render('result.html');
});

app.get('/about', (req, res) => {
    res.render('about.html');
});

// Example route using helper function
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        const tracks = await spotifyHelpers.searchTracks(query);
        res.json(tracks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000);
console.log('Server is listening on port 3000');