const centerLat = 38.9765;
const centerLng = -77.4898;

const map = L.map("map").setView([centerLat, centerLng], 8);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// Radar layer management
let radarLayer = null;
let lastRadarUrl = null;

function getRadarUrl() {
  const timestamp = Date.now(); // Used to bust cache
  return `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi?time=${timestamp}`;
}

function refreshRadarLayer() {
  const radarUrl = getRadarUrl();
  if (radarUrl === lastRadarUrl) return; // Skip if no update

  lastRadarUrl = radarUrl;

  if (radarLayer) {
    map.removeLayer(radarLayer);
  }

  radarLayer = L.tileLayer.wms(radarUrl, {
    layers: "nexrad-n0q-900913",
    format: "image/png",
    transparent: true,
    opacity: 0.6
  }).addTo(map);

  // Visual smoothing
  setTimeout(() => {
    const container = radarLayer.getContainer?.();
    if (container) {
      container.style.imageRendering = "auto";
      container.style.filter = "blur(1px) brightness(0.75) contrast(2)";
    }
  }, 500);
}

// Initial load
refreshRadarLayer();

// Check every 2 minutes
setInterval(() => {
  console.log("Checking for radar update...");
  refreshRadarLayer();
}, 2 * 60 * 1000);
