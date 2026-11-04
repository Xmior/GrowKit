// Cloud Movement
const clouds = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? [] : document.querySelectorAll('.cloud');

clouds.forEach((cloud, index) => {
    resetCloud(cloud, window.innerWidth);
});

// Clouds wait while they're hidden, so anti-lag and weather backgrounds cost no frames
const cloudsPaused = () => document.body.classList.contains('anti-lag') || document.body.classList.contains('has-weather');
const waitingClouds = [];

document.addEventListener('growkit-look', () => {
    if (!cloudsPaused()) waitingClouds.splice(0).forEach((resume) => resume());
});

function moveCloud(cloud, speed) {
    function animate() {
        if (cloudsPaused()) {
            waitingClouds.push(animate);
            return;
        }
        let left = parseInt(cloud.style.left);
        left -= speed;
        cloud.style.left = left + 'px';

        const screenWidth = window.innerWidth;
        if (left < -cloud.clientWidth) {
            resetCloud(cloud, screenWidth);
        } else {
            requestAnimationFrame(animate);
        }
    }

    animate();
}

function resetCloud(cloud, screenWidth) {
    const startTop = Math.random() * window.innerHeight * 0.3;
    const startLeft = screenWidth + Math.random() * screenWidth;
    cloud.style.top = startTop + 'px';
    cloud.style.left = startLeft + 'px';

    
    const randomScale = Math.random() * 0.5 + 0.75;
    cloud.style.transform = `scale(${randomScale})`;

    const speed = Math.random() * 2 + 1;

    requestAnimationFrame(() => moveCloud(cloud, speed));
}
