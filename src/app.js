const OFFICE = {
  name: "Vasagatan 7",
  lat: 57.698017,
  lon: 11.964622,
};

const statusText = document.querySelector("#statusText");
const sunText = document.querySelector("#sunText");
const weatherText = document.querySelector("#weatherText");
const dateInput = document.querySelector("#dateInput");
const timeInput = document.querySelector("#timeInput");
const radiusInput = document.querySelector("#radiusInput");
const loadButton = document.querySelector("#loadButton");
const resultsList = document.querySelector("#results");

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(
    date.getDate()
  )}`;
}

function getStockholmDateTimeParts(date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: get("hour"),
    minute: get("minute"),
  };
}

const today = new Date();
dateInput.value = formatLocalDate(today);
timeInput.value = "12:00";

const map = L.map("map").setView([OFFICE.lat, OFFICE.lon], 15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const officeMarker = L.marker([OFFICE.lat, OFFICE.lon]).addTo(map);
officeMarker.bindPopup(`<b>${OFFICE.name}</b><br/>Din startpunkt`).openPopup();

const restaurantLayer = L.layerGroup().addTo(map);
const sunLayer = L.layerGroup().addTo(map);
let radiusCircle = null;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda1 = toRadians(lon1);
  const lambda2 = toRadians(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
  const angularDistance = distanceMeters / 6371000;
  const bearingRad = toRadians(bearingDeg);
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (lon2 * 180) / Math.PI,
  };
}

function angleDifference(a, b) {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function getSelectedDateTime() {
  const dateStr = dateInput.value;
  const timeStr = timeInput.value || "12:00";
  return new Date(`${dateStr}T${timeStr}:00`);
}

function parseHeightMeters(tags) {
  const rawHeight = tags?.height;
  if (rawHeight) {
    const parsed = Number.parseFloat(String(rawHeight).replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const rawLevels = tags?.["building:levels"];
  if (rawLevels) {
    const levels = Number.parseFloat(String(rawLevels).replace(",", "."));
    if (Number.isFinite(levels) && levels > 0) {
      return levels * 3.2;
    }
  }

  return 12;
}

function getCentroid(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 3) {
    return null;
  }
  const validPoints = geometry.filter(
    (point) => typeof point.lat === "number" && typeof point.lon === "number"
  );
  if (validPoints.length < 3) {
    return null;
  }

  const sum = validPoints.reduce(
    (acc, point) => {
      acc.lat += point.lat;
      acc.lon += point.lon;
      return acc;
    },
    { lat: 0, lon: 0 }
  );

  return {
    lat: sum.lat / validPoints.length,
    lon: sum.lon / validPoints.length,
  };
}

function estimateFootprintRadiusMeters(geometry, centroid) {
  if (!centroid) {
    return 6;
  }

  let maxRadius = 0;
  geometry.forEach((point) => {
    const radius = haversineMeters(centroid.lat, centroid.lon, point.lat, point.lon);
    maxRadius = Math.max(maxRadius, radius);
  });

  return Math.max(6, maxRadius);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSunGradientColors(sunScore) {
  const ratio = clamp(sunScore / 100, 0, 1);
  const hue = Math.round(ratio * 120);
  return {
    markerFill: `hsl(${hue}, 80%, 50%)`,
    markerStroke: `hsl(${hue}, 80%, 35%)`,
    pillBg: `hsl(${hue}, 90%, 92%)`,
    pillText: `hsl(${hue}, 70%, 24%)`,
  };
}

function getSunGeometry(dateTime) {
  const sunPosition = SunCalc.getPosition(dateTime, OFFICE.lat, OFFICE.lon);
  return {
    sunAzimuthDeg: ((sunPosition.azimuth * 180) / Math.PI + 180 + 360) % 360,
    sunAltitudeDeg: (sunPosition.altitude * 180) / Math.PI,
  };
}

function drawSunDirection(sunAzimuthDeg, sunAltitudeDeg, radiusMeters) {
  sunLayer.clearLayers();
  if (sunAltitudeDeg <= 0) {
    return;
  }

  const rayLengthMeters = Math.max(180, Math.min(900, radiusMeters * 0.75));
  const endPoint = destinationPoint(
    OFFICE.lat,
    OFFICE.lon,
    sunAzimuthDeg,
    rayLengthMeters
  );
  const ray = L.polyline(
    [
      [OFFICE.lat, OFFICE.lon],
      [endPoint.lat, endPoint.lon],
    ],
    {
      color: "#f4a300",
      weight: 4,
      opacity: 0.9,
      dashArray: "10 8",
      lineCap: "round",
    }
  ).addTo(sunLayer);
  ray.bindPopup(
    `Solriktning: ${Math.round(sunAzimuthDeg)}°<br/>Solhöjd: ${sunAltitudeDeg.toFixed(
      1
    )}°`
  );

  const sunIcon = L.divIcon({
    className: "sun-marker-icon",
    html: '<div class="sun-marker">☀</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
  L.marker([endPoint.lat, endPoint.lon], { icon: sunIcon })
    .bindPopup("Härifrån kommer solen in mot området.")
    .addTo(sunLayer);
}

function renderRestaurants(restaurants) {
  resultsList.innerHTML = "";
  restaurantLayer.clearLayers();

  restaurants.forEach((restaurant) => {
    const colorScale = getSunGradientColors(restaurant.sunScore);
    const item = document.createElement("li");
    item.className = "result-card";
    item.innerHTML = `
      <h3>${restaurant.name}</h3>
      <p><strong>Solpoäng:</strong> ${restaurant.sunScore}/100 <span class="score-pill" style="--pill-bg: ${colorScale.pillBg}; --pill-color: ${colorScale.pillText}; --pill-border: ${colorScale.markerStroke};">${restaurant.sunLabel}</span></p>
      <p><strong>Skuggrisk:</strong> ${restaurant.shadeRiskLabel}</p>
      <p><strong>Avstånd:</strong> ${Math.round(restaurant.distance)} m</p>
      <p><strong>Riktning från kontoret:</strong> ${restaurant.directionText}</p>
      <p class="source-note">${restaurant.note}</p>
      <a href="https://www.openstreetmap.org/?mlat=${restaurant.lat}&mlon=${restaurant.lon}#map=18/${restaurant.lat}/${restaurant.lon}" target="_blank" rel="noreferrer">Öppna i OpenStreetMap</a>
    `;
    resultsList.appendChild(item);
    const marker = L.circleMarker([restaurant.lat, restaurant.lon], {
      radius: 6,
      color: colorScale.markerStroke,
      weight: 1.5,
      fillColor: colorScale.markerFill,
      fillOpacity: 0.85,
    });
    marker.bindPopup(
      `<b>${restaurant.name}</b><br/>Solpoäng: ${restaurant.sunScore}/100<br/>Avstånd: ${Math.round(restaurant.distance)} m`
    );
    restaurantLayer.addLayer(marker);
  });
}

function drawRadiusCircle(radiusMeters) {
  if (radiusCircle) {
    map.removeLayer(radiusCircle);
  }
  radiusCircle = L.circle([OFFICE.lat, OFFICE.lon], {
    radius: radiusMeters,
    fillColor: "#4f8ed9",
    fillOpacity: 0.08,
    color: "#2d6fbf",
    weight: 1,
  }).addTo(map);
}

async function fetchBuildings(radiusMeters) {
  const query = `
    [out:json][timeout:30];
    (
      way["building"](around:${radiusMeters},${OFFICE.lat},${OFFICE.lon});
    );
    out tags geom;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
  });

  if (!response.ok) {
    throw new Error("Kunde inte hämta byggnadsdata från OpenStreetMap.");
  }

  const data = await response.json();
  return (data.elements ?? [])
    .map((element) => {
      const centroid = getCentroid(element.geometry);
      if (!centroid) {
        return null;
      }

      return {
        id: `building-${element.id}`,
        centroid,
        footprintRadius: estimateFootprintRadiusMeters(element.geometry, centroid),
        heightMeters: parseHeightMeters(element.tags),
      };
    })
    .filter(Boolean);
}

async function fetchRestaurants(radiusMeters) {
  const query = `
    [out:json][timeout:25];
    (
      nwr["amenity"="restaurant"](around:${radiusMeters},${OFFICE.lat},${OFFICE.lon});
      nwr["amenity"="cafe"](around:${radiusMeters},${OFFICE.lat},${OFFICE.lon});
      nwr["amenity"="fast_food"](around:${radiusMeters},${OFFICE.lat},${OFFICE.lon});
    );
    out center tags;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
  });

  if (!response.ok) {
    throw new Error("Kunde inte hämta restauranger från OpenStreetMap.");
  }

  const data = await response.json();
  return data.elements
    .map((element) => {
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") {
        return null;
      }
      return {
        id: `${element.type}-${element.id}`,
        name:
          element.tags?.name ||
          element.tags?.brand ||
          "Namnlös restaurang/cafe",
        lat,
        lon,
      };
    })
    .filter(Boolean);
}

async function fetchCloudCover(dateTime) {
  const stockholmParts = getStockholmDateTimeParts(dateTime);
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${OFFICE.lat}&longitude=${OFFICE.lon}&hourly=cloud_cover&timezone=Europe%2FStockholm&start_date=${stockholmParts.date}&end_date=${stockholmParts.date}`
  );

  if (!response.ok) {
    throw new Error("Kunde inte hämta väderdata.");
  }

  const data = await response.json();
  const times = data?.hourly?.time ?? [];
  const clouds = data?.hourly?.cloud_cover ?? [];
  const target = `${stockholmParts.date}T${stockholmParts.hour}`;

  const foundIndex = times.findIndex((timeStr) => timeStr.startsWith(target));
  if (foundIndex >= 0) {
    return clouds[foundIndex];
  }
  return 50;
}

function getDirectionText(angle) {
  const dirs = [
    "norr",
    "nordost",
    "ost",
    "sydost",
    "söder",
    "sydväst",
    "väst",
    "nordväst",
  ];
  const index = Math.round(angle / 45) % 8;
  return dirs[index];
}

function estimateBuildingShadeRisk(
  restaurant,
  buildings,
  sunAzimuthDeg,
  sunAltitudeDeg
) {
  if (sunAltitudeDeg <= 0 || !buildings.length) {
    return 0;
  }

  const altitudeRadians = toRadians(Math.max(1, sunAltitudeDeg));
  const shadowDirectionDeg = (sunAzimuthDeg + 180) % 360;
  const maxShadowSearchDistance = Math.min(500, 120 / Math.tan(altitudeRadians));

  let strongestRisk = 0;

  buildings.forEach((building) => {
    const centerDistance = haversineMeters(
      building.centroid.lat,
      building.centroid.lon,
      restaurant.lat,
      restaurant.lon
    );

    // Many OSM restaurant points are mapped at a building center.
    // Skip that host building to avoid inflated self-shadow penalties.
    if (centerDistance <= building.footprintRadius + 1) {
      return;
    }

    if (
      centerDistance >
      maxShadowSearchDistance + building.footprintRadius + 20
    ) {
      return;
    }

    const edgeDistance = Math.max(0, centerDistance - building.footprintRadius);
    const shadowLength = building.heightMeters / Math.tan(altitudeRadians);
    if (edgeDistance > shadowLength + 8) {
      return;
    }

    const buildingToRestaurant = bearingDegrees(
      building.centroid.lat,
      building.centroid.lon,
      restaurant.lat,
      restaurant.lon
    );
    const angleToShadow = angleDifference(buildingToRestaurant, shadowDirectionDeg);
    const spread = Math.min(
      85,
      12 + ((building.footprintRadius + 3) / Math.max(4, edgeDistance)) * 60
    );
    if (angleToShadow > spread) {
      return;
    }

    const directionalFactor = Math.max(0, 1 - angleToShadow / spread);
    const distanceFactor = Math.max(0, 1 - edgeDistance / (shadowLength + 0.1));
    const heightFactor = Math.min(1.25, building.heightMeters / 20);
    const risk = directionalFactor * distanceFactor * heightFactor;

    strongestRisk = Math.max(strongestRisk, risk);
  });

  return Math.max(0, Math.min(1, strongestRisk));
}

function shadeRiskLabel(shadeRisk) {
  if (shadeRisk >= 0.7) {
    return "Hög (byggnadsskugga sannolik)";
  }
  if (shadeRisk >= 0.4) {
    return "Medel (viss skuggrisk)";
  }
  return "Låg (mer öppet mot solen)";
}

function calculateSunRank(restaurants, dateTime, cloudCover, buildings) {
  const { sunAzimuthDeg, sunAltitudeDeg } = getSunGeometry(dateTime);
  const skyFactor = Math.max(0, 1 - cloudCover / 100);
  const weatherFactor = 0.35 + skyFactor * 0.65;
  const isSunAboveHorizon = sunAltitudeDeg > 0;
  const altitudeFactor = Math.max(0, Math.min(1, sunAltitudeDeg / 35));

  let totalShadeRisk = 0;

  const ranked = restaurants
    .map((restaurant) => {
      const distance = haversineMeters(
        OFFICE.lat,
        OFFICE.lon,
        restaurant.lat,
        restaurant.lon
      );
      const bearing = bearingDegrees(
        OFFICE.lat,
        OFFICE.lon,
        restaurant.lat,
        restaurant.lon
      );
      const shadeRisk = estimateBuildingShadeRisk(
        restaurant,
        buildings,
        sunAzimuthDeg,
        sunAltitudeDeg
      );
      totalShadeRisk += shadeRisk;

      const lightAccessFactor = 1 - shadeRisk;
      const sunlightStrength = isSunAboveHorizon
        ? weatherFactor * lightAccessFactor * (0.65 + altitudeFactor * 0.35)
        : 0;
      const sunScore = Math.round(Math.max(0, Math.min(1, sunlightStrength)) * 100);

      let sunLabel = "Lägre chans för sol";
      if (sunScore >= 75) {
        sunLabel = "Mycket bra solläge";
      } else if (sunScore >= 50) {
        sunLabel = "Möjligt solläge";
      }

      return {
        ...restaurant,
        sunScore,
        sunLabel,
        shadeRiskLabel: shadeRiskLabel(shadeRisk),
        distance,
        directionText: getDirectionText(bearing),
        note: "Solpoängen uppskattas från solhöjd, molnighet och om byggnader i solens riktning kan kasta skugga på platsen.",
      };
    })
    .sort((a, b) => b.sunScore - a.sunScore || a.distance - b.distance);

  return {
    ranked,
    sunAzimuthDeg,
    sunAltitudeDeg,
    averageShadeRisk: restaurants.length ? totalShadeRisk / restaurants.length : 0,
  };
}

async function loadAndRender() {
  try {
    loadButton.disabled = true;
    statusText.textContent = "Hämtar restauranger...";
    weatherText.textContent = "";
    sunText.textContent = "";

    const radius = Number(radiusInput.value);
    const dateTime = getSelectedDateTime();
    drawRadiusCircle(radius);
    const { sunAzimuthDeg, sunAltitudeDeg } = getSunGeometry(dateTime);
    drawSunDirection(sunAzimuthDeg, sunAltitudeDeg, radius);

    const buildingPromise = fetchBuildings(radius)
      .then((buildings) => ({ buildings, buildingDataAvailable: true }))
      .catch(() => ({ buildings: [], buildingDataAvailable: false }));

    const [restaurants, cloudCover, buildingResult] = await Promise.all([
      fetchRestaurants(radius),
      fetchCloudCover(dateTime),
      buildingPromise,
    ]);

    if (!restaurants.length) {
      statusText.textContent = "Hittade inga restauranger i vald radie.";
      resultsList.innerHTML = "";
      restaurantLayer.clearLayers();
      sunText.textContent = `Solens riktning: ${Math.round(
        sunAzimuthDeg
      )}° | Solhöjd: ${sunAltitudeDeg.toFixed(1)}°`;
      return;
    }

    const { ranked, averageShadeRisk } =
      calculateSunRank(
      restaurants,
      dateTime,
      cloudCover,
      buildingResult.buildings
    );

    renderRestaurants(ranked);

    statusText.textContent = `Visar ${ranked.length} restauranger, sorterade på solpoäng. Alla är markerade på kartan.`;
    sunText.textContent = `Solens riktning: ${Math.round(
      sunAzimuthDeg
    )}° | Solhöjd: ${sunAltitudeDeg.toFixed(1)}°`;
    const shadeSummary = buildingResult.buildingDataAvailable
      ? `Genomsnittlig skuggrisk i området: ${Math.round(
          averageShadeRisk * 100
        )}%.`
      : "Byggnadsdata kunde inte hämtas, så skuggrisk är förenklad.";
    weatherText.textContent = `Molnighet enligt prognos: ${Math.round(
      cloudCover
    )}%. ${shadeSummary}`;
  } catch (error) {
    statusText.textContent = error.message;
    resultsList.innerHTML = "";
    restaurantLayer.clearLayers();
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadAndRender);
loadAndRender();
