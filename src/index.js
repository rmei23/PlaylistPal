require('dotenv').config();

const OpenAI = require('openai');
const express = require('express');
const path = require('path');
const axios = require('axios');
const querystring = require('querystring');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const Redis = require('ioredis');
const spotifyHelpers = require('./helpers/helpers');

const app = express();

// Add middleware to parse JSON bodes
app.use(express.json());

// Set up Redis client for session store
process.env.DEBUG = 'ioredis:*';

// Use Railway-provided Redis URL
const redisClient = new Redis(process.env.REDIS_URL);

// Trust Railway's proxy for secure cookies
app.set('trust proxy', 1);

// Set up session middleware to use Redis
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60, // 1 hour
        httpOnly: true,
        sameSite: 'none' // Allow cross-site cookies for OAuth
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
                console.log('Refreshed Spotify token for user.');
            } catch (refreshError) {
                console.error('Spotify access token expired and refresh failed for user:', refreshError);
                return res.status(401).json({ error: 'Spotify access token expired and refresh failed. Please log in again.' });
            }
        } else if (!accessToken) {
            console.error('Spotify access token missing or expired for user.');
            return res.status(401).json({ error: 'Spotify access token missing or expired. Please log in again.' });
        }
        // All Spotify API requests below use the current user's access token

        // 1. Call OpenAI to get playlist songs
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const systemPrompt = `Given the following playlist description, respond ONLY with a valid JSON array of exactly ${numSongs} objects, each with an 'artist' and 'track' key, representing songs that fit the description. Do NOT include any explanation, markdown, or extra text. Do NOT include any properties, objects, or output except the JSON array. Example: [ {"artist": "Phoebe Bridgers", "track": "Kyoto"}, {"artist": "The 1975", "track": "If You’re Too Shy (Let Me Know)"} ]\nPlaylist description: "${prompt}"`;
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
            let jsonMatch = text.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                try {
                    songList = JSON.parse(jsonMatch[0]);
                } catch (err) {
                    console.error('Failed to parse extracted JSON array:', jsonMatch[0]);
                    return res.status(500).json({ error: 'Failed to parse OpenAI response as JSON array.', openai_response: text });
                }
            } else {
                console.error('No JSON array found in OpenAI response.');
                return res.status(500).json({ error: 'No JSON array found in OpenAI response.', openai_response: text });
            }
        } catch (err) {
            return res.status(500).json({ error: 'Failed to parse OpenAI response as JSON.', openai_response: completion });
        }
        if (!Array.isArray(songList) || songList.length === 0) {
            return res.status(500).json({ error: 'OpenAI did not return any songs.' });
        }

        // 2. For each { artist, track } pair, search Spotify for the track to get its URI
        // --- All Spotify API requests below are on behalf of the current user ---
        const foundTracks = [];
        for (const item of songList) {
            if (!item.artist || !item.track) continue;
            try {
                // Try a more forgiving search: "track name artist name"
                let q = `${item.track} ${item.artist}`;
                let searchRes = await axios.get('https://api.spotify.com/v1/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: { q, type: 'track', limit: 1 }
                });
                let track = searchRes.data.tracks.items[0];
                // Fallback: try searching by track only if not found
                if (!track) {
                    q = item.track;
                    searchRes = await axios.get('https://api.spotify.com/v1/search', {
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        params: { q, type: 'track', limit: 1 }
                    });
                    track = searchRes.data.tracks.items[0];
                }
                if (track && track.uri) {
                    foundTracks.push({ uri: track.uri, artist: track.artists[0].name, title: track.name });
                }
            } catch (err) {
                // Skip if not found
                console.error('Error searching for track:', err.response ? err.response.data : err.message);
                continue;
            }
        }
        if (foundTracks.length === 0) {
            return res.status(400).json({ error: 'No matching tracks found on Spotify.' });
        }

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
        // Add tracks to playlist
        const uris = foundTracks.map(t => t.uri);
        await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            uris
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        // Return playlist URL and track list
        // Store playlist info in session for /result page
        req.session.playlist_url = playlistRes.data.external_urls.spotify;
        res.json({
            playlist_url: playlistRes.data.external_urls.spotify,
            playlist_id: playlistId
        });
    } catch (err) {
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
            expires_at: Date.now() + (data.expires_in * 1000),
            refresh_token: data.refresh_token // Store refresh token if present
        };
        console.log('Session after setting spotifyToken:', req.session);
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
    
    if (Date.now() > req.session.spotifyToken.expires_at) {
        return res.redirect('/login');
    }
    
    next();
}

// Protect routes that need authentication
app.get('/home', (req, res) => {
    if (!req.session.spotifyToken || Date.now() > req.session.spotifyToken.expires_at) {
        res.render('home.html', { authenticated: false });
    } else {
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

app.listen(3000);
console.log('Server is listening on port 3000');