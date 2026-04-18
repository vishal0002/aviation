// --- STATE MANAGEMENT ---
let fleetDatabase = null;
let currentAircraft = null;

// --- PHASE 1: THE DATA PIPELINE ---
async function initializeApp() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/load-and-trim/sw.js', { scope: '/load-and-trim/' });
    }
    try {
        const response = await fetch('https://api.evovhil.com'); 
        if (!response.ok) throw new Error("Network offline or fetch failed");
        
        const data = await response.json();
        fleetDatabase = data.ftos.carver_aviation;
        
        localStorage.setItem('fleet_data_vault', JSON.stringify(fleetDatabase));
        console.log("Live data loaded and vaulted!");
    } catch (error) {
        console.warn("Using offline tarmac mode. Loading from vault.");
        const vaultedData = localStorage.getItem('fleet_data_vault');
        if (vaultedData) {
            fleetDatabase = JSON.parse(vaultedData);
        } else {
            alert("No internet and no cached data. Connect to Wi-Fi once to initialize.");
            return;
        }
    }
    populateTailDropdown();
}

// --- PHASE 2: THE UI RENDERER (DYNAMIC ROWS) ---
function renderPayloadStations() {
    const container = document.getElementById('dynamic-payload-container');
    container.innerHTML = ''; // Clear out the old rows

    if (!currentAircraft) return;

    currentAircraft.stations.forEach((station, index) => {
        const tr = document.createElement('tr');
        tr.className = 'row-input';

        // Check if this station is fuel (needs Liters to Kg conversion)
        let inputHTML = '';
        if (station.is_fuel) {
            inputHTML = `
                <div class="input-cell">
                    <input type="number" id="in-${station.id}" class="calc-input" placeholder="0" min="0" inputmode="decimal">
                    <span class="input-unit">L</span>
                </div>
                <span id="disp-${station.id}-kg" class="computed-sub">— kg</span>
            `;
        } else {
            inputHTML = `
                <div class="input-cell">
                    <input type="number" id="in-${station.id}" class="calc-input" placeholder="0" min="0" inputmode="decimal">
                    <span class="input-unit">kg</span>
                </div>
            `;
        }

        // Optional max limit text
        let subText = station.max_kg ? `<span class="item-sub">Max: ${station.max_kg} kg</span>` : '';

        // Inject the row HTML
        tr.innerHTML = `
            <td class="col-sr">${index + 2}</td>
            <td class="col-item">
                <span class="item-name">${station.name}</span>
                ${subText}
            </td>
            <td class="col-wt">${inputHTML}</td>
            <td class="col-arm"><span id="disp-${station.id}-arm" class="fixed-val">${station.arm.toFixed(2)}</span></td>
            <td class="col-moment"><span id="disp-${station.id}-moment" class="computed-val">—</span></td>
        `;
        container.appendChild(tr);
    });

    // Add event listeners to the newly created inputs so math runs instantly
    document.querySelectorAll('.calc-input').forEach(input => {
        input.addEventListener('input', runCalculations);
    });
}

// --- PHASE 3: THE UNIVERSAL MATH ENGINE ---
function calculateMoment(weight, arm) {
    return weight * arm;
}

function runCalculations() {
    if (!currentAircraft) return;

    // Start with the Basic Empty Weight
    let totalWeight = currentAircraft.bew_kg;
    let totalMoment = calculateMoment(currentAircraft.bew_kg, currentAircraft.bew_arm);
    let totalBaggage = 0;

    // 1. Loop through all dynamically generated stations
    currentAircraft.stations.forEach(station => {
        const inputEl = document.getElementById(`in-${station.id}`);
        let inputValue = parseFloat(inputEl.value) || 0;
        let weightKg = 0;

        if (station.is_fuel) {
            weightKg = inputValue * currentAircraft.constants.avgas_sg;
            document.getElementById(`disp-${station.id}-kg`).innerText = weightKg.toFixed(1) + ' kg';
        } else {
            weightKg = inputValue;
        }

        // Track baggage weight for envelope checks
        if (station.id.includes('bag')) {
            totalBaggage += weightKg;
        }

        let moment = calculateMoment(weightKg, station.arm);
        totalWeight += weightKg;
        totalMoment += moment;

        // Update row moment on screen
        document.getElementById(`disp-${station.id}-moment`).innerText = (inputValue > 0) ? moment.toFixed(0) : '—';
    });

    // 2. Update Static Output Rows (BEW, Ramp, Taxi)
    document.getElementById('disp-bew-wt').innerText = currentAircraft.bew_kg.toFixed(2);
    document.getElementById('disp-bew-arm').innerText = currentAircraft.bew_arm.toFixed(2);
    document.getElementById('disp-bew-moment').innerText = calculateMoment(currentAircraft.bew_kg, currentAircraft.bew_arm).toFixed(0);

    document.getElementById('disp-ramp-wt').innerText = totalWeight.toFixed(2);
    document.getElementById('disp-ramp-moment').innerText = totalMoment.toFixed(0);

    const taxiFuelKg = currentAircraft.constants.taxi_fuel_kg;
    const taxiArm = currentAircraft.constants.taxi_fuel_arm;
    const taxiMoment = calculateMoment(taxiFuelKg, taxiArm);

    document.getElementById('disp-taxi-wt').innerText = taxiFuelKg.toFixed(2);
    document.getElementById('disp-taxi-arm').innerText = taxiArm.toFixed(2);
    document.getElementById('disp-taxi-moment').innerText = taxiMoment.toFixed(0);

    // 3. Final Takeoff Math
    let takeoffWeight = totalWeight - taxiFuelKg;
    let takeoffMoment = totalMoment - taxiMoment;
    let finalCG = takeoffMoment / takeoffWeight;

    // 4. Update Final Output Displays
    document.getElementById('out-tow').innerText = takeoffWeight.toFixed(2);
    document.getElementById('out-cg').innerText = finalCG.toFixed(2);

    // 5. Fire off the HTML visual enhancements (Status cards, chips)
    if (typeof window.refreshDisplayLayer === 'function') {
        window.refreshDisplayLayer(takeoffWeight, finalCG, totalBaggage);
    }
}

// --- DOM BINDINGS ---
function populateTailDropdown() {
    const select = document.getElementById('select-tail');
    select.innerHTML = '<option value="">Select Tail Number</option>';

    fleetDatabase.fleet.forEach(ac => {
        let opt = document.createElement('option');
        opt.value = ac.tail_number;
        opt.innerText = `${ac.tail_number} (${ac.type})`;
        select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
        const tail = e.target.value;
        currentAircraft = fleetDatabase.fleet.find(a => a.tail_number === tail);

        if (currentAircraft) {
            // Generate the exact number of rows for this specific aircraft
            renderPayloadStations();
            // Run math to populate everything initially
            runCalculations();
        } else {
            document.getElementById('dynamic-payload-container').innerHTML = '';
        }
    });
}

// Boot up
window.onload = initializeApp;
