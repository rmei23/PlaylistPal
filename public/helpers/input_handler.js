let inputSeeds = [];

// Function to update the displayed list of seeds
function updateSeedList() {
    const seedListDiv = document.getElementById('seed-list');
    seedListDiv.innerHTML = '';
    if (inputSeeds.length > 0) {
        const ul = document.createElement('ul');
        inputSeeds.forEach((seed, idx) => {
            const li = document.createElement('li');
            li.textContent = seed.name + (seed.type === 'artist' ? ' (artist)' : '') + ' ';
            // Create delete button
            const delBtn = document.createElement('button');
            delBtn.textContent = '✖';
            delBtn.style.marginLeft = '8px';
            delBtn.style.cursor = 'pointer';
            delBtn.onclick = function() {
                inputSeeds.splice(idx, 1);
                updateSeedList();
            };
            li.appendChild(delBtn);
            ul.appendChild(li);
        });
        seedListDiv.appendChild(ul);
    } else {
        seedListDiv.textContent = 'No seeds selected yet.';
    }
}



// Add an event listener for form submission
document.getElementById('input-seeds').addEventListener('submit', async function(event) {
    event.preventDefault();
    const input = document.querySelector('input[name="seed-input"]');
    const value = input.value.trim();
    if (inputSeeds.length >= 5) {
        alert('You have reached the maximum number of seeds (5).');
        input.value = '';
        return;
    }
    if (!value) {
        input.value = '';
        return;
    }

    // Try to search for artist
    try {
        const res = await fetch(`/api/search-artist?name=${encodeURIComponent(value)}`);
        if (res.ok) {
            const data = await res.json();
            const artists = data.artists;
            if (artists.length === 1) {
                // Only one match, add directly
                inputSeeds.push({ name: artists[0].name, id: artists[0].id, type: 'artist' });
                updateSeedList();
            } else if (artists.length > 1) {
                // Multiple matches, show modal for user to select
                showArtistModal(artists, function(selectedArtist) {
                    if (selectedArtist) {
                        inputSeeds.push({ name: selectedArtist.name, id: selectedArtist.id, type: 'artist' });
                        updateSeedList();
                    }
                });
            } else {
                // No match, treat as plain seed
                inputSeeds.push({ name: value, id: null, type: 'plain' });
                updateSeedList();
            }
        } else {
            // If error (e.g., not authenticated), treat as plain seed
            inputSeeds.push({ name: value, id: null, type: 'plain' });
            updateSeedList();
        }
    } catch (err) {
        // Network or other error, treat as plain seed
        inputSeeds.push({ name: value, id: null, type: 'plain' });
        updateSeedList();
    }
    input.value = '';
});

// Show modal for artist selection
function showArtistModal(artists, onSelect) {
    const modal = document.getElementById('artist-modal');
    const optionsDiv = document.getElementById('artist-options');
    optionsDiv.innerHTML = '';
    artists.forEach(artist => {
        const option = document.createElement('div');
        option.style.display = 'flex';
        option.style.alignItems = 'center';
        option.style.marginBottom = '12px';
        if (artist.image) {
            const img = document.createElement('img');
            img.src = artist.image;
            img.alt = artist.name;
            img.style.width = '48px';
            img.style.height = '48px';
            img.style.borderRadius = '50%';
            img.style.marginRight = '12px';
            option.appendChild(img);
        }
        const info = document.createElement('div');
        info.innerHTML = `<strong>${artist.name}</strong><br><small>${artist.genres.join(', ') || ''}</small><br><small>Popularity: ${artist.popularity}</small>`;
        option.appendChild(info);
        const selectBtn = document.createElement('button');
        selectBtn.textContent = 'Select';
        selectBtn.style.marginLeft = '16px';
        selectBtn.onclick = function() {
            modal.style.display = 'none';
            onSelect(artist);
        };
        option.appendChild(selectBtn);
        optionsDiv.appendChild(option);
    });
    document.getElementById('artist-modal-cancel').onclick = function() {
        modal.style.display = 'none';
        onSelect(null);
    };
    modal.style.display = 'flex';
}


document.addEventListener('DOMContentLoaded', updateSeedList);

// Generate Playlist button logic
const generateBtn = document.getElementById('generate-button');
if (generateBtn) {
    generateBtn.onclick = async function(e) {
        e.preventDefault();
        if (inputSeeds.length === 0) {
            alert('Please add at least one seed.');
            return;
        }
        // Separate seeds by type
        const seed_artists = inputSeeds.filter(s => s.type === 'artist' && s.id).map(s => s.id).join(',');
        const seed_tracks = inputSeeds.filter(s => s.type === 'track' && s.id).map(s => s.id).join(',');
        const seed_genres = inputSeeds.filter(s => s.type === 'genre' && s.name).map(s => s.name).join(',');
        const payload = {
            seed_artists,
            seed_tracks,
            seed_genres,
            limit: 10, // or let user choose
            playlist_name: 'PlaylistPal Recommendations'
        };
        try {
            const res = await fetch('/api/generate-playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok && data.playlist_url) {
                // Save to sessionStorage and redirect
                sessionStorage.setItem('playlist_url', data.playlist_url);
                sessionStorage.setItem('tracks', JSON.stringify(data.tracks));
                window.location.href = '/result';
            } else {
                alert(data.error || 'Failed to generate playlist.');
            }
        } catch (err) {
            alert('Error generating playlist.');
        }
    };
}

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
                    li.textContent = track;
                    ul.appendChild(li);
                });
            }
        }
    });
}