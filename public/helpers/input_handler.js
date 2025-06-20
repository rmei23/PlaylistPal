// Prompt-based playlist generation
// Submit prompt to backend and redirect to result on success
document.getElementById('prompt-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    const promptInput = document.getElementById('playlist-prompt');
    const prompt = promptInput.value.trim();
    const lengthInput = document.getElementById('playlist-length');
    let playlistLength = parseInt(lengthInput.value, 10) || 20;
    if (playlistLength < 1) playlistLength = 1;
    if (playlistLength > 100) playlistLength = 100;
    if (!prompt) {
        alert('Please enter a playlist description.');
        return;
    }
    try {
        const res = await fetch('/api/generate-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, playlistLength })
        });
        const data = await res.json();
        if (res.ok && data.playlist_url) {
            sessionStorage.setItem('playlist_url', data.playlist_url);
            sessionStorage.setItem('tracks', JSON.stringify(data.tracks));
            window.location.href = '/result';
        } else {
            alert(data.error || 'Failed to generate playlist.');
        }
    } catch (err) {
        alert('Error generating playlist.');
    }
});

// On /result page, populate the playlist info from sessionStorage
if (window.location.pathname === '/result') {
    document.addEventListener('DOMContentLoaded', function() {
        const playlistUrl = sessionStorage.getItem('playlist_url');
        const tracks = JSON.parse(sessionStorage.getItem('tracks') || '[]');
        if (playlistUrl) {
            const link = document.querySelector('.playlist-link');
            if (link) link.href = playlistUrl;
        }
        if (tracks.length > 0) {
            const ul = document.querySelector('ul');
            if (ul) {
                ul.innerHTML = '';
                tracks.forEach(track => {
                    const li = document.createElement('li');
                    // If track is an object with artist and title, show nicely
                    if (typeof track === 'object' && track.artist && track.title) {
                        li.textContent = `${track.artist} – ${track.title}`;
                    } else {
                        li.textContent = track;
                    }
                    ul.appendChild(li);
                });
            }
        }
    });
}