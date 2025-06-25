// setPlaylistCover.js
// Helper to upload a custom cover image to a Spotify playlist

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Set the cover image for a Spotify playlist.
 * @param {string} playlistId - The Spotify playlist ID
 * @param {string} accessToken - The user's Spotify access token
 * @param {string} imagePath - Absolute path to the JPEG image
 */
async function setPlaylistCover(playlistId, accessToken, imagePath) {
    // Read and encode the image as base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    // Upload to Spotify (must be JPEG, <=256KB)
    await axios({
        method: 'put',
        url: `https://api.spotify.com/v1/playlists/${playlistId}/images`,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'image/jpeg'
        },
        data: base64Image
    });
}

module.exports = setPlaylistCover;
