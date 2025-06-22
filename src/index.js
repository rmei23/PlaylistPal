require('dotenv').config();

const OpenAI = require('openai');
const express = require('express'); // To build an application server or API
const path = require('path');
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part B.
const querystring = require('querystring');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const Redis = require('ioredis');
const spotifyHelpers = require('./helpers/helpers');

const app = express();

// Add middleware to parse JSON bodes
app.use(express.json());

// Set up Redis client for session store
const redisClient = new Redis({
    host: 'redis-16874.c241.us-east-1-4.ec2.redns.redis-cloud.com',
    port: 16874,
    password: 'arSj2UkaJ7BZm6t3gHPln3xsUYsuFIOW'
    // no username, no tls
  });

// Set up RedisStore instance for session store
const store = new RedisStore({ client: redisClient });

// Set up session middleware to use Redis
app.use(session({
    store,
    secret: 'your_session_secret', // Change this to a secure random string
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 1000 * 60 * 60, // 1 hour
        httpOnly: true
    }
}));

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('views', path.join(__dirname, '..', 'public', 'views'));

var client_id = process.env.CLIENT_ID;
var redirect_uri = process.env.REDIRECT_URI;
console.log('REDIRECT_URI:', process.env.REDIRECT_URI);

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
        let spotifyToken = req.session.spotifyToken;
        let accessToken = spotifyToken && spotifyToken.access_token;
        let expiresAt = spotifyToken && spotifyToken.expires_at;
        let refreshToken = spotifyToken && spotifyToken.refresh_token;
        // If token expired but we have a refresh token, refresh it
        if ((!accessToken || Date.now() > expiresAt) && refreshToken) {
            try {
                const tokenData = await spotifyHelpers.refreshAccessToken(refreshToken);
                accessToken = tokenData.access_token;
                // Update session with new token and expiration
                req.session.spotifyToken.access_token = accessToken;
                req.session.spotifyToken.expires_in = tokenData.expires_in;
                req.session.spotifyToken.expires_at = Date.now() + (tokenData.expires_in * 1000);
                // Optionally update refresh_token if provided
                if (tokenData.refresh_token) {
                    req.session.spotifyToken.refresh_token = tokenData.refresh_token;
                }
            } catch (refreshError) {
                console.error('Failed to refresh Spotify token:', refreshError.response ? refreshError.response.data : refreshError.message);
                return res.status(401).json({ error: 'Spotify access token expired and refresh failed. Please log in again.' });
            }
        } else if (!accessToken) {
            return res.status(401).json({ error: 'Spotify access token missing or expired. Please log in again.' });
        }
        // Now perform the artist search
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

app.post('/api/generate-playlist', async (req, res) => {
    try {
        const { prompt, playlistLength } = req.body;
        let numSongs = parseInt(playlistLength, 10);
        if (isNaN(numSongs) || numSongs < 1) numSongs = 20;
        if (numSongs > 100) numSongs = 100;
        if (!prompt) {
            return res.status(400).json({ error: 'Missing playlist prompt.' });
        }
        // Check for OpenAI API Key
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: 'OpenAI API key not set in .env.' });
        }
        // Ensure we have a valid access token (with refresh logic)
        let spotifyToken = req.session.spotifyToken;
        let accessToken = spotifyToken && spotifyToken.access_token;
        let expiresAt = spotifyToken && spotifyToken.expires_at;
        let refreshToken = spotifyToken && spotifyToken.refresh_token;
        if ((!accessToken || Date.now() > expiresAt) && refreshToken) {
            try {
                const tokenData = await spotifyHelpers.refreshAccessToken(refreshToken);
                accessToken = tokenData.access_token;
                req.session.spotifyToken.access_token = accessToken;
                req.session.spotifyToken.expires_in = tokenData.expires_in;
                req.session.spotifyToken.expires_at = Date.now() + (tokenData.expires_in * 1000);
                if (tokenData.refresh_token) {
                    req.session.spotifyToken.refresh_token = tokenData.refresh_token;
                }
            } catch (refreshError) {
                return res.status(401).json({ error: 'Spotify access token expired and refresh failed. Please log in again.' });
            }
        } else if (!accessToken) {
            return res.status(401).json({ error: 'Spotify access token missing or expired. Please log in again.' });
        }

        // 1. Call OpenAI to get playlist songs
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const systemPrompt = `Given the following playlist description, respond ONLY with a valid JSON array of exactly ${numSongs} objects, each with an 'artist' and 'track' key, representing songs that fit the description. Do NOT include any explanation or extra text. Example: [ {"artist": "Phoebe Bridgers", "track": "Kyoto"}, {"artist": "The 1975", "track": "If You’re Too Shy (Let Me Know)"} ]\nPlaylist description: "${prompt}"`;
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are a playlist generator for Spotify.' },
                { role: 'user', content: systemPrompt }
            ],
            max_tokens: 600,
            temperature: 0.8
        });
        // Try to parse the response as JSON
        let songList;
        try {
            if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message || !completion.choices[0].message.content) {
                console.error('Unexpected OpenAI API response:', JSON.stringify(completion, null, 2));
                return res.status(500).json({ error: 'OpenAI API did not return expected response structure.', openai_response: completion });
            }
            const text = completion.choices[0].message.content.trim();
            console.log('Raw OpenAI response:', text); // Log the response for debugging
            try {
                songList = JSON.parse(text);
            } catch (err) {
                // Attempt to extract JSON array from the response if extra text is present
                const match = text.match(/\[.*\]/s);
                if (match) {
                    songList = JSON.parse(match[0]);
                } else {
                    throw err;
                }
            }
        } catch (err) {
            return res.status(500).json({ error: 'Failed to parse OpenAI response as JSON.', openai_response: completion });
        }
        if (!Array.isArray(songList) || songList.length === 0) {
            return res.status(500).json({ error: 'OpenAI did not return any songs.' });
        }

        // 2. For each { artist, track } pair, search Spotify for the track to get its URI
        const foundTracks = [];
        for (const item of songList) {
            if (!item.artist || !item.track) continue;
            try {
                const q = `track:${item.track} artist:${item.artist}`;
                const searchRes = await axios.get('https://api.spotify.com/v1/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: { q, type: 'track', limit: 1 }
                });
                const track = searchRes.data.tracks.items[0];
                if (track && track.uri) {
                    foundTracks.push({ uri: track.uri, artist: track.artists[0].name, title: track.name });
                }
            } catch (err) {
                // Skip if not found
                continue;
            }
        }
        if (foundTracks.length === 0) {
            return res.status(400).json({ error: 'No matching tracks found on Spotify.' });
        }

        // 3. Create a new playlist
        // Find a unique playlist name: playlistPal, playlistPal 1, playlistPal 2, ...
        let baseName = 'playlistPal';
        let playlistName = baseName;
        let suffix = 1;
        let existing = true;
        while (existing) {
            // Search for existing playlists with this name
            const existingRes = await axios.get('https://api.spotify.com/v1/me/playlists', {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: { limit: 50 }
            });
            existing = existingRes.data.items.some(p => p.name === playlistName);
            if (existing) {
                playlistName = `${baseName} ${suffix++}`;
            }
        }
        const playlistRes = await axios.post('https://api.spotify.com/v1/me/playlists', {
            name: playlistName,
            public: false
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const playlistId = playlistRes.data.id;
        // 4. Add tracks to playlist
        const uris = foundTracks.map(t => t.uri);
        await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            uris
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        // 5. Return playlist URL and track list
        // Store playlist info in session for /result page
        req.session.playlist_url = playlistRes.data.external_urls.spotify;
        res.json({
            playlist_url: playlistRes.data.external_urls.spotify,
            playlist_id: playlistId
        });
    } catch (err) {
        // Log full error details for debugging
        console.error('Error generating playlist:', err);
        if (err.response && err.response.data) {
            res.status(500).json({ error: 'Failed to generate playlist', details: err.response.data });
        } else {
            res.status(500).json({ error: 'Failed to generate playlist', details: err.message });
        }
    }
});

app.get('/login', function(req, res) {
    // If user is already authenticated, redirect to home
    if (req.session.spotifyToken && Date.now() <= req.session.spotifyToken.expires_at) {
        return res.redirect('/home');
    }

    var state = spotifyHelpers.generateRandomString(16);
    var scope = 'user-read-private user-read-email playlist-modify-private playlist-modify-public';

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
    console.log('HIT /callback');
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
            expires_at: Date.now() + (data.expires_in * 1000), // Calculate expiration time
            refresh_token: data.refresh_token // Store refresh token if present
        };
        console.log('Session after setting spotifyToken:', req.session);
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
    console.log('HIT /home, session:', req.session);
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
    const playlist_url = req.session.playlist_url || '';
    const tracks = req.session.tracks || [];
    // Clear session data after rendering to avoid stale info
    req.session.playlist_url = undefined;
    req.session.tracks = undefined;
    res.render('result.html', { playlist_url, tracks });
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