inputSeeds = [];

// Add an event listener for form submission
document.getElementById('input-seeds').addEventListener('submit', function(event) {
    // Prevent the default form submission (which reloads the page)
    event.preventDefault();
    
    inputSeeds.push(document.querySelector('input[name="seed-input"]').value);
    
    // Log the input value to the console (or handle it as needed)
    console.log("inputSeeds: ", inputSeeds);
});