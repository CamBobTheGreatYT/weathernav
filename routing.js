let userLocation;
let routeSteps = [];
let stepIndex = 0;
let routeLine;
let trackingId = null;
let alerted = false; // Prevent repeat alerts
let hwyRt = false;

// Initial location snapshot
navigator.geolocation.getCurrentPosition(
    (pos) => {
        userLocation = [pos.coords.latitude, pos.coords.longitude];

        const userIcon = L.divIcon({
            className: 'user-location-icon',
            iconSize: [20, 20]
        });

        window.initialLocationMarker = L.marker(userLocation, { icon: userIcon })
            .addTo(map)
            //.bindPopup("You are here")
            //.openPopup();
        map.setView(userLocation, 13);
    },
    (err) => {
        console.error("Geolocation error:", err.message);
        alert("Unable to detect your location. Please check browser permissions and try again.");
    }
);

document.getElementById("collapseBtn").onclick = () => {
    const panel = document.getElementById("instructionPanel");
    panel.classList.toggle("collapsed");

    const icon = document.querySelector("#collapseBtn i");
    icon.className = panel.classList.contains("collapsed")
        ? "fas fa-chevron-right"
        : "fas fa-chevron-left";
};


// Route calculation
async function routeToDestination(customOrigin = null) {
    const query = document.getElementById("searchInput").value;
    const origin = customOrigin || userLocation;
    if (!query || !origin) {
        alert("Please enter a destination and allow location access.");
        return;
    }

    const geocodeRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
    );
    const results = await geocodeRes.json();
    if (!results[0]) {
        alert("Destination not found.");
        return;
    }

    const destLatLng = [parseFloat(results[0].lat), parseFloat(results[0].lon)];
    L.marker(destLatLng).addTo(map).bindPopup("Destination");

    const routeRes = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${destLatLng[1]},${destLatLng[0]}?overview=full&geometries=geojson&steps=true`
    );
    const routeData = await routeRes.json();

    if (!routeData.routes || routeData.routes.length === 0) {
        alert("Route could not be calculated.");
        return;
    }

    const routeGeoJSON = routeData.routes[0].geometry;
    routeSteps = routeData.routes[0].legs[0].steps;
    checkHighwayRatio();
    stepIndex = 0;
    alerted = false;

    const routeDurationSeconds = routeData.routes[0].duration;
    const routeDistanceMeters = routeData.routes[0].distance;

    window.avgRouteSpeed = routeDistanceMeters / routeDurationSeconds;
    if (hwyRt) {window.assumedSpeed = window.avgRouteSpeed * 1.35;}
    else {window.assumedSpeed = window.avgRouteSpeed * 1.15;}
    window.remainingRouteDistance = routeDistanceMeters;

    const now = new Date();
    const assumedSpeed = window.assumedSpeed || window.avgRouteSpeed || 13.4;
    const initialSeconds = routeDistanceMeters / assumedSpeed;
    const arrival = new Date(now.getTime() + initialSeconds * 1000);
    const formattedETA = arrival.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    const totalHours = Math.floor(initialSeconds / 3600);
    const totalMinutes = Math.round((initialSeconds % 3600) / 60);
    const totalDurationFormatted = totalHours > 0
        ? `${totalHours} hr ${totalMinutes} min`
        : `${totalMinutes} min`;

    const totalMiles = (routeDistanceMeters / 1609.34).toFixed(1);

    document.getElementById("etaText").textContent = formattedETA;
    document.getElementById("durationText").textContent = totalDurationFormatted;
    document.getElementById("distanceText").textContent = `${totalMiles} mi`;


    window.routeEndCoord = routeSteps[routeSteps.length - 1].maneuver.location;
    window.routeGeometryCoords = routeGeoJSON.coordinates;

    if (routeLine) {
        map.removeLayer(routeLine);
    }
    routeLine = L.geoJSON(routeGeoJSON, {
        style: { color: "blue", weight: 5 }
    }).addTo(map);

    map.fitBounds(routeLine.getBounds());

    updateNextInstruction();
    updateInstructionList();

    // Show "Start Route" button only if not rerouting mid-trip
    if (!trackingId && !document.getElementById("startBtn")) {
        const startBtn = document.createElement("button");
        startBtn.id = "startBtn";
        startBtn.innerHTML = `<i class="fas fa-arrow-right"></i>`;
        startBtn.className = "start-button";
        startBtn.onclick = beginTracking;
        document.getElementById("instructionPanel").appendChild(startBtn);
    }

    document.getElementById("endBtn").style.display = "block";

}

function checkHighwayRatio() {
    if (!routeSteps || routeSteps.length === 0) return;

    const highwayKeywords = ["I-", "Interstate", "Hwy", "Highway", "US-", "Route", "i-", "interstate", "hwy", "highway", "us-", "route"];
    let highwayMiles = 0;
    let localMiles = 0;

    routeSteps.forEach((step) => {
        const name = step.name || "";
        const miles = step.distance / 1609.34;

        if (highwayKeywords.some(keyword => name.includes(keyword))) {
            highwayMiles += miles * 2;
        } else {
            localMiles += miles;
        }
    });

    const totalMiles = highwayMiles + localMiles;
    const highwayRatio = totalMiles > 0 ? (highwayMiles / totalMiles * 100).toFixed(1) : 0;

    //alert(`Highway distance: ${highwayMiles.toFixed(2)} mi`);
    //alert(`Local distance: ${localMiles.toFixed(2)} mi`);
    //alert(`Highway ratio: ${highwayRatio}%`);

    hwyRt = highwayRatio > 25; //this was originally 50% changed to 25 so that it would actually say going to ny is on the highway and give a correct time estimate
}

function hasPassedManeuver(idx, userLoc) {
    if (!routeSteps || !routeSteps[idx]) return false;
    const man = routeSteps[idx].maneuver.location; // [lon, lat]
    const manLat = man[1], manLon = man[0];
    const userLat = userLoc[0], userLon = userLoc[1];

    // Need a "next" point to define forward direction; fall back to route geometry end if missing
    const next = routeSteps[idx + 1]?.maneuver?.location || window.routeGeometryCoords?.[window.routeGeometryCoords.length - 1];
    if (!next) return false;
    const nextLat = next[1], nextLon = next[0];

    // Approx meters conversion
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.cos(manLat * Math.PI / 180) * 111320;

    // Vector from maneuver -> next, and maneuver -> user (in meters)
    const vx = (nextLon - manLon) * metersPerDegLon;
    const vy = (nextLat - manLat) * metersPerDegLat;
    const ux = (userLon - manLon) * metersPerDegLon;
    const uy = (userLat - manLat) * metersPerDegLat;

    const dot = vx * ux + vy * uy;
    const distToMan = map.distance(L.latLng(userLat, userLon), L.latLng(manLat, manLon));

    // If the user lies ahead along the maneuver->next direction (dot>0) and is not extremely close, treat as passed.
    return dot > 0 && distToMan > 50; // 50m buffer, tweak if needed
}


// Begin live tracking
function beginTracking() {
    if (trackingId) return;

    if (window.initialLocationMarker) {
        map.removeLayer(window.initialLocationMarker);
        window.initialLocationMarker = null;
    }

    document.getElementById("startBtn").style.display = "none";

    const dummy = new SpeechSynthesisUtterance("Navigation started");
    speechSynthesis.speak(dummy);

    if (routeSteps && routeSteps.length > 0 && userLocation) {
        const step = routeSteps[stepIndex];
        const text = step.maneuver.instruction || `${step.maneuver.type} on ${step.name || "road"}`;

        const maneuverCoord = L.latLng(step.maneuver.location[1], step.maneuver.location[0]);
        const userCoord = L.latLng(userLocation[0], userLocation[1]);
        const distance = map.distance(userCoord, maneuverCoord);
        const distanceFormatted = formatDistance(distance);

        const spokenText = `In ${distanceFormatted}, ${text}`;
        speechSynthesis.speak(new SpeechSynthesisUtterance(spokenText));
    }

    //speechSynthesis.speak(new SpeechSynthesisUtterance(`In ${distanceFormatted}, ${text}`));

    trackingId = navigator.geolocation.watchPosition(
        (pos) => {
            userLocation = [pos.coords.latitude, pos.coords.longitude];

            const buffer = 0.005; // ~0.5km

            const bounds = L.latLngBounds(
                [userLocation[0] - buffer, userLocation[1] - buffer],
                [userLocation[0] + buffer, userLocation[1] + buffer]
            );
            map.setMaxBounds(bounds.pad(3)); // Pad by 3x to preload a larger tile area

            // Zoom and center
            map.setView(userLocation, 16);

            // Live marker
            const userIcon = L.divIcon({
                className: 'user-location-icon',
                iconSize: [20, 20]
            });

            if (!window.liveMarker) {
                window.liveMarker = L.marker(userLocation, { icon: userIcon }).addTo(map);
            } else {
                window.liveMarker.setLatLng(userLocation);
            }


            // Compass rotation setup
            if (typeof window.rotateMap === "undefined") {
                window.rotateMap = true;

                const compassEl = document.getElementById("compass");

                compassEl.onclick = () => {
                    window.rotateMap = !window.rotateMap;

                    const label = window.rotateMap ? "Rotation On" : "Rotation Off";
                    compassEl.title = label;

                    // Reset any existing transform when toggled off
                    if (!window.rotateMap) {
                        document.getElementById("map").style.transform = "rotate(0deg)";
                        compassEl.style.transform = "rotate(0deg)";
                    }
                };
            }


            if (window.lastLocation) {
                const deltaLat = userLocation[0] - window.lastLocation[0];
                const deltaLng = userLocation[1] - window.lastLocation[1];
                const headingRadians = Math.atan2(deltaLng, deltaLat);
                const headingDeg = (headingRadians * 180) / Math.PI;

                if (window.rotateMap) {
                    document.getElementById("map").style.transform = `rotate(${-headingDeg}deg)`;
                }
                document.getElementById("compass").style.transform = `rotate(${-headingDeg - 45}deg)`;
            }
            window.lastLocation = [...userLocation];

            // Save route start time if first update
            if (!window.routeStartTime) {
                window.routeStartTime = Date.now();
            }

            // Turn alert logic
            if (stepIndex < routeSteps.length) {

                // If user started mid-route and already past upcoming steps, advance until next is ahead
                while (stepIndex < routeSteps.length && hasPassedManeuver(stepIndex, userLocation)) {
                    stepIndex++;
                    alerted = false;
                    window.oneMileAlerted = false;
                    updateNextInstruction();
                    updateInstructionList();
                    updateSpeedLimitDisplay();
                }

                if (stepIndex < routeSteps.length) {
                    const nextStep = routeSteps[stepIndex];
                    const target = nextStep.maneuver.location;
                    const distanceToTurn = map.distance(
                        L.latLng(userLocation[0], userLocation[1]),
                        L.latLng(target[1], target[0])
                    );

                    if (!window.oneMileAlerted && distanceToTurn > 1550 && distanceToTurn < 1650) {
                        const text = nextStep.maneuver.instruction || `${nextStep.maneuver.type} on ${nextStep.name || "road"}`;
                        const step = routeSteps[stepIndex];
                        const modifier = step.maneuver.modifier || "";
                        const roadName = step.name || "the road";

                        let directionText = "";
                        switch (modifier) {
                            case "left": directionText = "Turn left"; break;
                            case "right": directionText = "Turn right"; break;
                            case "straight": directionText = "Go straight"; break;
                            case "slight left": directionText = "Bear left"; break;
                            case "slight right": directionText = "Bear right"; break;
                            case "uturn": directionText = "Make a U-turn"; break;
                            default: directionText = step.maneuver.instruction || `${step.maneuver.type} on ${roadName}`;
                        }

                        const spokenText = `${directionText} onto ${roadName}`;
                        speechSynthesis.speak(new SpeechSynthesisUtterance(`In one mile, ${spokenText}`));
                        window.oneMileAlerted = true;
                    }

                    const prevDist = stepIndex === 0 ? 9999 : routeSteps[stepIndex - 1].distance;
                    const threshold = prevDist > 1609 ? 1609 : 321.87;

                    if (!alerted && distanceToTurn < threshold + 100 && distanceToTurn > threshold - 100) {
                        const step = routeSteps[stepIndex];
                        const modifier = step.maneuver.modifier || "";
                        const roadName = step.name || "the road";

                        let directionText = "";
                        switch (modifier) {
                            case "left": directionText = "Turn left"; break;
                            case "right": directionText = "Turn right"; break;
                            case "straight": directionText = "Go straight"; break;
                            case "slight left": directionText = "Bear left"; break;
                            case "slight right": directionText = "Bear right"; break;
                            case "uturn": directionText = "Make a U-turn"; break;
                            default: directionText = step.maneuver.instruction || `${step.maneuver.type} on ${roadName}`;
                        }

                        const maneuverCoord = L.latLng(nextStep.maneuver.location[1], nextStep.maneuver.location[0]);
                        const userCoord = L.latLng(userLocation[0], userLocation[1]);
                        const distanceToNext = map.distance(userCoord, maneuverCoord);

                        const distanceFormatted = formatDistance(distanceToNext);
                        const spokenText = `In ${distanceFormatted}, ${directionText} onto ${roadName}`;
                        speechSynthesis.speak(new SpeechSynthesisUtterance(spokenText));
                        alerted = true;
                    }

                    if (distanceToTurn < 30.48) {
                        stepIndex++;
                        alerted = false;
                        window.oneMileAlerted = false;
                        updateNextInstruction();
                        updateInstructionList();
                        updateSpeedLimitDisplay();
                    }
                }

                updateInstructionList();
                updateNextInstruction();
                updateSpeedLimitDisplay(); // ⬅️ Refresh speed limit when step changes
            }

            // ETA + miles left updater
            if (routeSteps.length > 0) {
                const remainingMeters = routeSteps
                    .slice(stepIndex)
                    .reduce((total, step) => total + step.distance, 0);

                const avgSpeed = window.assumedSpeed || window.avgRouteSpeed || 13.4;
                const estSecondsLeft = remainingMeters / avgSpeed;
                const elapsedSeconds = (Date.now() - window.routeStartTime) / 1000;
                const adjustedSecondsLeft = Math.max(estSecondsLeft - elapsedSeconds, 60);

                const now = new Date();
                const eta = new Date(now.getTime() + adjustedSecondsLeft * 1000);
                const formattedETA = eta.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                });

                const hours = Math.floor(adjustedSecondsLeft / 3600);
                const minutes = Math.round((adjustedSecondsLeft % 3600) / 60);
                const durationFormatted = hours > 0
                    ? `${hours} hr ${minutes} min`
                    : `${minutes} min`;

                const milesLeft = (remainingMeters / 1609.34).toFixed(1);

                document.getElementById("etaText").textContent = formattedETA;
                document.getElementById("durationText").textContent = durationFormatted;
                document.getElementById("distanceText").textContent = `${milesLeft} mi`;
            }

            // Off-route detection → reroute if off track > 5s
            if (window.routeGeometryCoords) {
                const userLatLng = L.latLng(userLocation[0], userLocation[1]);
                const onRoute = window.routeGeometryCoords.some(coord => {
                    const point = L.latLng(coord[1], coord[0]);
                    return map.distance(userLatLng, point) < 100;
                });

                if (!onRoute) {
                    if (!window.offRouteStart) {
                        window.offRouteStart = Date.now();
                    } else {
                        const timeOffRoute = Date.now() - window.offRouteStart;
                        if (timeOffRoute > 5000) {
                            //console.log("Off route! Recalculating...");
                            speechSynthesis.speak(new SpeechSynthesisUtterance("Recalculating route"));
                            window.offRouteStart = null;
                            routeToDestination(userLocation);
                            return;
                        }
                    }
                } else {
                    window.offRouteStart = null;
                }
            }
        },
        (err) => {
            console.error("Live tracking error:", err.message);
        },
        { enableHighAccuracy: true }
    );

    const startBtn = document.getElementById("startBtn");
    if (startBtn) {
        startBtn.remove();
    }
}

// Update next instruction
function updateNextInstruction() {
    if (stepIndex >= routeSteps.length) {
        document.getElementById("navText").textContent = "Arrived at destination";
        document.querySelector("#navInstruction i").className = "fas fa-flag-checkered";
        speechSynthesis.speak(new SpeechSynthesisUtterance("You have arrived"));
        return;
    }

    const step = routeSteps[stepIndex];
    //const text = step.maneuver.instruction || `${step.maneuver.type} on ${step.name || "road"}`;
    const type = step.maneuver.type;

    // 🔁 Live distance calculation
    let distance = step.distance;
    if (userLocation && step.maneuver.location) {
        const maneuverCoord = L.latLng(step.maneuver.location[1], step.maneuver.location[0]);
        const userCoord = L.latLng(userLocation[0], userLocation[1]);
        distance = map.distance(userCoord, maneuverCoord);
    }
    const distanceFormatted = formatDistance(distance);

    const text = step.maneuver.instruction || `${step.maneuver.type} on ${step.name || "road"}`;
    document.getElementById("navText").textContent = `In ${distanceFormatted}: ${text}`;
    
    const iconMap = {
        left: "fa-arrow-left",
        right: "fa-arrow-right",
        straight: "fa-arrow-up",
        depart: "fa-play",
        arrive: "fa-flag-checkered",
        roundabout: "fa-circle-notch"
    };
    const iconClass = iconMap[type] || "fa-arrow-up";
    document.querySelector("#navInstruction i").className = `fas ${iconClass}`;

    // 🎙️ Updated spoken instruction
    //speechSynthesis.speak(new SpeechSynthesisUtterance(`In ${distanceFormatted}, ${text}`));
}


// Format distance
function formatDistance(meters) {
    if (meters < 161) {
        return `${Math.round(meters * 3.28084)} ft`;
    } else if (meters < 1609) {
        const miles = meters / 1609.34;
        if (miles < 0.33) return "¼ mi";
        if (miles < 0.42) return "⅓ mi";
        if (miles < 0.58) return "½ mi";
        if (miles < 0.70) return "⅔ mi";
        return "¾ mi";
    } else {
        return `${(meters / 1609.34).toFixed(1)} mi`;
    }
}

// Instruction list
function updateInstructionList() {
    const list = document.getElementById("instructionList");
    list.innerHTML = "";

    const maxStepsToShow = 3;
    const startIndex = stepIndex;

    for (let i = startIndex; i < Math.min(routeSteps.length, startIndex + maxStepsToShow); i++) {
        const step = routeSteps[i];
        const text = step.maneuver.instruction || `${step.maneuver.type} on ${step.name || "road"}`;

        let distance;

        if (i === startIndex) {
            // 🧭 First item: distance from user to next maneuver
            const maneuverCoord = L.latLng(step.maneuver.location[1], step.maneuver.location[0]);
            const userCoord = L.latLng(userLocation[0], userLocation[1]);
            distance = map.distance(userCoord, maneuverCoord);
        } else {
            // 📍 Subsequent items: distance between maneuvers
            const prevStep = routeSteps[i - 1];
            const fromCoord = L.latLng(prevStep.maneuver.location[1], prevStep.maneuver.location[0]);
            const toCoord = L.latLng(step.maneuver.location[1], step.maneuver.location[0]);
            distance = map.distance(fromCoord, toCoord);
        }

        const distanceFormatted = formatDistance(distance);

        const li = document.createElement("li");
        li.textContent = `In ${distanceFormatted} → ${text}`;
        list.appendChild(li);
    }
}




// Reset route
function clearRoute() {
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }

    if (trackingId) {
        navigator.geolocation.clearWatch(trackingId);
        trackingId = null;
    }

    routeSteps = [];
    stepIndex = 0;

    map.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
            map.removeLayer(layer);
        }
    });

    document.getElementById("instructionList").innerHTML = "";
    document.getElementById("navText").textContent = "";
    document.querySelector("#navInstruction i").className = "fas fa-arrow-up";

    const startBtn = document.getElementById("startBtn");
    if (startBtn) {
        startBtn.remove();
    }

    document.getElementById("endBtn").style.display = "none";
}

function updateSpeedLimitDisplay() {
    if (stepIndex >= routeSteps.length) {
        document.getElementById("speedLimitSign").style.display = "none";
        return;
    }

    const step = routeSteps[stepIndex];
    let speedLimit = step.speed_limit || null;

    // 🔄 If OSRM doesn't give speed limits, simulate basic logic:
    if (!speedLimit && step.name) {
        const name = step.name;
        //if (name.match(/I-|Interstate|US-|Route \d+/)) speedLimit = 65;
        //else if (name.match(/Ave|St|Blvd|Dr|Rd/)) speedLimit = 35;
        speedLimit = 0; // Unknown road type
    }

    if (speedLimit) {
        document.getElementById("speedLimitValue").textContent = speedLimit;
        document.getElementById("speedLimitSign").style.display = "block";
    } else {
        document.getElementById("speedLimitSign").style.display = "none";
    }
}
