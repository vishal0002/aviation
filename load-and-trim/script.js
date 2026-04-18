// --- STATE MANAGEMENT ---
// These globals are read by your index.html Display Layer!
let fleetDatabase = null;
let currentAircraft = null;
let currentModelSpecs = null;

// --- PHASE 1: THE DATA PIPELINE ---
async function initializeApp() {
    // 1. Register the Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/load-and-trim/sw.js', { scope: '/load-and-trim/' });
    }

    // 2. Fetch from Cloudflare or Vault
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

    // 2. Fuel Math
    const fuelWeight = fuelLiters * currentModelSpecs.constants.avgas_sg;
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

    // Final C.G. Calculation
    let finalCG = takeoffMoment / takeoffWeight;

    // Feed the base outputs (Your HTML Display Layer will intercept this and style everything else!)
    document.getElementById('out-tow').innerText = takeoffWeight.toFixed(2);
    document.getElementById('out-cg').innerText = finalCG.toFixed(2);
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
            
            // Apply UI defaults
            document.getElementById('in-rear-pax').value = fleetDatabase.ui_defaults.rear_pax_kg;
            document.getElementById('in-bag1').value = fleetDatabase.ui_defaults.baggage_1_kg;
            document.getElementById('in-bag2').value = fleetDatabase.ui_defaults.baggage_2_kg;
            
            // Run math instantly. Your index.html intercepts this automatically.
            runCalculations();
        }
    });

    const inputs = document.querySelectorAll('.calc-input');
    inputs.forEach(input => input.addEventListener('input', runCalculations));
}

// Boot up
window.onload = initializeApp;
