require('dotenv').config();

const express = require('express'); // To build an application server or API
const path = require('path');
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part B.
const querystring = require('querystring');
const session = require('express-session');
const spotifyHelpers = require('./helpers/helpers');

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

app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('views', path.join(__dirname, '..', 'public', 'views'));

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

// Endpoint to search for artists by name
app.get('/api/search-artist', async (req, res) => {
    const name = req.query.name;
    if (!name) {
        return res.status(400).json({ error: 'Missing artist name' });
    }
    try {
        // Ensure we have a valid access token in the session
        let accessToken = req.session.spotifyToken && req.session.spotifyToken.access_token;
        if (!accessToken || Date.now() > req.session.spotifyToken.expires_at) {
            return res.status(401).json({ error: 'Spotify access token missing or expired. Please log in again.' });
        }
        const response = await axios.get('https://api.spotify.com/v1/search', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            params: {
                q: name,
                type: 'artist',
                limit: 5
            }
        });
        const artists = response.data.artists.items.map(artist => ({
            name: artist.name,
            id: artist.id,
            image: artist.images && artist.images[0] ? artist.images[0].url : null,
            genres: artist.genres,
            popularity: artist.popularity
        }));
        res.json({ artists });
    } catch (err) {
        console.error('Error searching for artist:', err.response ? err.response.data : err.message);
        res.status(500).json({ error: 'Failed to search for artist' });
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