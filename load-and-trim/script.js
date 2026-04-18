// --- STATE MANAGEMENT ---
let fleetDatabase = null;
let currentAircraft = null;
let currentModelSpecs = null;

// --- PWA INSTALL STATE ---
let deferredPrompt;

// --- PHASE 1: THE DATA PIPELINE ---
async function initializeApp() {
    // 1. Register the Service Worker for offline capability
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/load-and-trim/sw.js', { scope: '/load-and-trim/' });
    }

    // 2. Fetch the JSON from Cloudflare Custom Domain or LocalStorage
    try {
        const response = await fetch('https://api.evovhil.com'); 
        if (!response.ok) throw new Error("Network offline or fetch failed");
        
        const data = await response.json();
        fleetDatabase = data.ftos.carver_aviation;
        
        // Save to the offline vault!
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

// --- PHASE 2: THE CALCULATION ENGINE ---
function calculateMoment(weight, arm) {
    return weight * arm;
}

function runCalculations() {
    if (!currentAircraft || !currentModelSpecs) return;

    // 1. Get Inputs from DOM
    const pilotWeight = parseFloat(document.getElementById('in-pilot').value) || 0;
    const rearPaxWeight = parseFloat(document.getElementById('in-rear-pax').value) || 0;
    const baggage1Weight = parseFloat(document.getElementById('in-bag1').value) || 0;
    const baggage2Weight = parseFloat(document.getElementById('in-bag2').value) || 0;
    const fuelLiters = parseFloat(document.getElementById('in-fuel').value) || 0;

    // 2. Fuel Math (Liters to Kg)
    const fuelWeight = fuelLiters * currentModelSpecs.constants.avgas_sg;

    // 3. Stations Setup
    const stations = currentModelSpecs.stations;
    
    // Summing Weights
    let zeroFuelWeight = currentAircraft.bew_kg + pilotWeight + rearPaxWeight + baggage1Weight + baggage2Weight;
    let rampWeight = zeroFuelWeight + fuelWeight;
    
    // Subtract Taxi Fuel to get Total Takeoff Weight
    const taxiFuelKg = currentModelSpecs.constants.taxi_fuel_kg;
    let takeoffWeight = rampWeight - taxiFuelKg;

    // Summing Moments
    let totalMoment = 
        calculateMoment(currentAircraft.bew_kg, currentAircraft.bew_arm) +
        calculateMoment(pilotWeight, stations.pilot_copilot_arm) +
        calculateMoment(rearPaxWeight, stations.rear_pax_arm) +
        calculateMoment(baggage1Weight, stations.baggage_1_arm) +
        calculateMoment(baggage2Weight, stations.baggage_2_arm) +
        calculateMoment(fuelWeight, stations.usable_fuel_arm);

    // Subtract Taxi Moment
    let taxiMoment = calculateMoment(taxiFuelKg, currentModelSpecs.constants.taxi_fuel_arm);
    let takeoffMoment = totalMoment - taxiMoment;

    // 4. Final C.G. Calculation
    let finalCG = takeoffMoment / takeoffWeight;

    // 5. Envelope Validation
    let limits = currentModelSpecs.limits;
    let isWeightSafe = takeoffWeight <= currentAircraft.mtow_kg;
    let isBaggageSafe = (baggage1Weight + baggage2Weight) <= limits.max_baggage_kg;
    let isCGSafe = (finalCG >= limits.cg_forward && finalCG <= limits.cg_aft);
    let isSafeToFly = isWeightSafe && isBaggageSafe && isCGSafe;

    // 6. Output Final Numbers to DOM
    document.getElementById('out-tow').innerText = takeoffWeight.toFixed(2);
    document.getElementById('out-cg').innerText = finalCG.toFixed(2);
    document.getElementById('out-status').innerText = isSafeToFly ? "WITHIN LIMITS ✅" : "NO GO ❌";

    // 7. NEW: Output Live Moments to the Table!
    // (Ensure these IDs match your index.html exactly)
    document.getElementById('val-fuel-wt').innerText = fuelWeight.toFixed(2); // Show fuel in kg
    document.getElementById('val-fuel-mom').innerText = calculateMoment(fuelWeight, stations.usable_fuel_arm).toFixed(2);
    document.getElementById('val-pilot-mom').innerText = calculateMoment(pilotWeight, stations.pilot_copilot_arm).toFixed(2);
    document.getElementById('val-pax-mom').innerText = calculateMoment(rearPaxWeight, stations.rear_pax_arm).toFixed(2);
    document.getElementById('val-bag1-mom').innerText = calculateMoment(baggage1Weight, stations.baggage_1_arm).toFixed(2);
    document.getElementById('val-bag2-mom').innerText = calculateMoment(baggage2Weight, stations.baggage_2_arm).toFixed(2);
}

// --- DOM BINDINGS ---
function populateTailDropdown() {
    const select = document.getElementById('select-tail');
    select.innerHTML = '<option value="">Select Tail Number</option>';
    
    fleetDatabase.fleet.forEach(ac => {
        let opt = document.createElement('option');
        opt.value = ac.tail_number;
        opt.innerText = `${ac.tail_number} (${ac.model})`;
        select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
        const tail = e.target.value;
        currentAircraft = fleetDatabase.fleet.find(a => a.tail_number === tail);
        if (currentAircraft) {
            currentModelSpecs = fleetDatabase.aircraft_models[currentAircraft.model];
            
            // --- NEW: UPDATE THE UI INFO CHIPS ON SELECTION ---
            document.getElementById('chip-model').innerText = currentAircraft.model;
            document.getElementById('chip-bew').innerText = currentAircraft.bew_kg;
            document.getElementById('chip-mtow').innerText = currentAircraft.mtow_kg;
            document.getElementById('chip-cg').innerText = `${currentModelSpecs.limits.cg_forward} - ${currentModelSpecs.limits.cg_aft}`;

            // --- NEW: UPDATE THE STATIC TABLE ROWS ON SELECTION ---
            document.getElementById('val-bew-wt').innerText = currentAircraft.bew_kg;
            document.getElementById('val-bew-arm').innerText = currentAircraft.bew_arm;
            document.getElementById('val-bew-mom').innerText = calculateMoment(currentAircraft.bew_kg, currentAircraft.bew_arm).toFixed(2);
            
            document.getElementById('val-fuel-arm').innerText = currentModelSpecs.stations.usable_fuel_arm;
            document.getElementById('val-pilot-arm').innerText = currentModelSpecs.stations.pilot_copilot_arm;
            document.getElementById('val-pax-arm').innerText = currentModelSpecs.stations.rear_pax_arm;
            document.getElementById('val-bag1-arm').innerText = currentModelSpecs.stations.baggage_1_arm;
            document.getElementById('val-bag2-arm').innerText = currentModelSpecs.stations.baggage_2_arm;

            // Apply UI defaults from database
            document.getElementById('in-rear-pax').value = fleetDatabase.ui_defaults.rear_pax_kg;
            document.getElementById('in-bag1').value = fleetDatabase.ui_defaults.baggage_1_kg;
            document.getElementById('in-bag2').value = fleetDatabase.ui_defaults.baggage_2_kg;
            
            // Run math instantly
            runCalculations();
        }
    });

    // Add event listeners to all inputs to calculate instantly on type
    const inputs = document.querySelectorAll('.calc-input');
    inputs.forEach(input => input.addEventListener('input', runCalculations));
}

// --- PHASE 3: PWA INSTALLATION LOGIC ---
function setupPWA() {
    const installBar = document.getElementById('pwa-install-bar');
    const installBtn = document.getElementById('pwa-install-btn');

    if (!installBar || !installBtn) return;

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Android's default mini-infobar
        e.preventDefault();
        // Stash the event so it can be triggered later
        deferredPrompt = e;
        // Un-hide your custom HTML banner
        installBar.style.display = 'flex'; 
    });

    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            // Show the official browser install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond
            const { outcome } = await deferredPrompt.userChoice;
            // Hide the banner if they accepted
            if (outcome === 'accepted') {
                installBar.style.display = 'none';
            }
            deferredPrompt = null;
        }
    });
}

// Boot up
window.onload = () => {
    initializeApp();
    setupPWA();
};
