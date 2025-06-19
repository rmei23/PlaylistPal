// Helper functions for Spotify API interactions
require('dotenv').config();
const axios = require('axios');
const querystring = require('querystring');

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Exchanges authorization code for access token
 * @param {string} code The authorization code returned by Spotify
 * @param {string} redirect_uri The redirect URI used in the initial auth request
 * @returns {Promise} Promise that resolves with the access token response
 */
async function getAccessToken(code, redirect_uri) {
    try {
        const tokenResponse = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            data: querystring.stringify({
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            }),
            headers: {
                'Authorization': 'Basic ' + Buffer.from(
                    process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET
                ).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        return tokenResponse.data;
    } catch (error) {
        console.error('Error in getAccessToken:', error.response ? error.response.data : error.message);
        throw error;
    }
}

/**
 * Refreshes an access token using a refresh token
 * @param {string} refresh_token
 * @returns {Promise} Promise that resolves with the new access token response
 */
async function refreshAccessToken(refresh_token) {
    try {
        const tokenResponse = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            data: querystring.stringify({
                refresh_token: refresh_token,
                grant_type: 'refresh_token'
            }),
            headers: {
                'Authorization': 'Basic ' + Buffer.from(
                    process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET
                ).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return tokenResponse.data;
    } catch (error) {
        console.error('Error in refreshAccessToken:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = {
    generateRandomString,
    getAccessToken,
    refreshAccessToken
};
