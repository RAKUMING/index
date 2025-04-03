// Function to set default dates (last 7 days)
function setDefaultDates() {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 7);

    // Format dates as YYYY-MM-DD for input type="date"
    const formatDate = (date) => date.toISOString().split('T')[0];

    document.getElementById('endDate').value = formatDate(end);
    document.getElementById('startDate').value = formatDate(start);
}

// Function to update status messages
function updateStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`; // Apply CSS class for styling
    statusDiv.style.display = 'block';
}

// Function to parse API data into a flat array of objects
function parseLiquidationData(data) {
    const allData = [];
    if (!data || !Array.isArray(data)) {
        console.error("Invalid data format received from API:", data);
        return []; // Return empty array if data is not as expected
    }

    data.forEach(symbolData => {
        if (!symbolData || !symbolData.symbol || !Array.isArray(symbolData.history)) {
            console.warn("Skipping invalid symbol data:", symbolData);
            return; // Skip this entry if it's malformed
        }
        const symbol = symbolData.symbol;
        symbolData.history.forEach(entry => {
            // Add symbol and convert timestamp to ISO string for better readability in CSV
            entry.symbol = symbol;
            if (entry.t) { // Coinalyze often uses 't' for timestamp
                entry.timestamp_iso = new Date(entry.t).toISOString();
            }
            allData.push(entry);
        });
    });
    return allData;
}

// Function to convert array of objects to CSV string
function convertToCSV(dataArray) {
    if (!dataArray || dataArray.length === 0) {
        return ""; // Return empty string if no data
    }

    const headers = Object.keys(dataArray[0]);
    // Ensure 'symbol' and 'timestamp_iso' are first if they exist
    const orderedHeaders = ['symbol', 'timestamp_iso', ...headers.filter(h => h !== 'symbol' && h !== 'timestamp_iso')];

    const headerString = orderedHeaders.join(',');

    const rows = dataArray.map(row => {
        return orderedHeaders.map(header => {
            let cell = row[header] === null || row[header] === undefined ? '' : row[header];
            let cellString = String(cell);
            // Escape double quotes by doubling them and wrap in double quotes if it contains comma, newline or double quote
            if (cellString.includes(',') || cellString.includes('\n') || cellString.includes('"')) {
                cellString = `"${cellString.replace(/"/g, '""')}"`;
            }
            return cellString;
        }).join(',');
    });

    return [headerString, ...rows].join('\n');
}

// Function to trigger CSV download
function downloadCSV(csvString, filename) {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    if (link.download !== undefined) { // Check if download attribute is supported
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up the object URL
    } else {
        // Fallback for older browsers (less common now)
        alert("CSV download is not supported in your browser.");
    }
}


// Main function to handle the fetch process
async function fetchAndDownload() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const symbols = document.getElementById('symbols').value.trim();
    const interval = document.getElementById('interval').value;
    const startDateStr = document.getElementById('startDate').value;
    const endDateStr = document.getElementById('endDate').value;
    const convertToUsd = document.getElementById('convertToUsd').checked ? "true" : "false";
    const fetchButton = document.getElementById('fetchButton');

    // Basic validation
    if (!apiKey || !symbols || !startDateStr || !endDateStr) {
        updateStatus("Please fill in API Key, Symbols, Start Date, and End Date.", 'error');
        return;
    }

    // Convert dates to UNIX timestamps (seconds)
    // Get timestamp at the beginning of the start day and end of the end day (local time)
    const fromTimestamp = Math.floor(new Date(startDateStr + 'T00:00:00').getTime() / 1000);
    const toTimestamp = Math.floor(new Date(endDateStr + 'T23:59:59.999').getTime() / 1000);

    if (isNaN(fromTimestamp) || isNaN(toTimestamp) || fromTimestamp >= toTimestamp) {
        updateStatus("Invalid date range selected.", 'error');
        return;
    }

    const baseUrl = "https://api.coinalyze.net/v1/liquidation-history";
    const params = new URLSearchParams({
        api_key: apiKey,
        symbols: symbols,
        interval: interval,
        from: fromTimestamp,
        to: toTimestamp,
        convert_to_usd: convertToUsd
    });

    const apiUrl = `${baseUrl}?${params.toString()}`;

    // Disable button and show loading status
    fetchButton.disabled = true;
    updateStatus(`Fetching data for ${symbols} from ${startDateStr} to ${endDateStr}...`, 'info');

    try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
            // Try to get error message from response body
            let errorMsg = `HTTP error ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json(); // Coinalyze might return JSON error details
                errorMsg = `Error ${response.status}: ${errorData.error || response.statusText}`;
            } catch (e) {
                // If response is not JSON or empty
                console.error("Could not parse error response:", e);
            }
            throw new Error(errorMsg);
        }

        const liquidationData = await response.json();

        if (!liquidationData || (Array.isArray(liquidationData) && liquidationData.length === 0) || (Array.isArray(liquidationData) && liquidationData.every(item => !item.history || item.history.length === 0))) {
            updateStatus("No liquidation data found for the specified parameters.", 'info');
        } else {
            updateStatus("Processing data...", 'info');
            const parsedData = parseLiquidationData(liquidationData);

            if (parsedData.length === 0) {
                 updateStatus("No valid history data found after parsing.", 'info');
                 return; // Exit if parsing resulted in no data
            }

            const csvData = convertToCSV(parsedData);

            if (csvData) {
                const safeSymbols = symbols.replace(/[^a-z0-9_,.-]/gi, '_').substring(0, 50); // Sanitize symbols for filename
                const filename = `coinalyze_liquidations_${safeSymbols}_${interval}_${startDateStr}_to_${endDateStr}.csv`;
                downloadCSV(csvData, filename);
                updateStatus(`Successfully downloaded data for ${parsedData.length} records.`, 'success');
            } else {
                updateStatus("Could not convert data to CSV.", 'error');
            }
        }

    } catch (error) {
        console.error("Failed to fetch or process data:", error);
        updateStatus(`Error: ${error.message}`, 'error');
    } finally {
        // Re-enable button
        fetchButton.disabled = false;
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', setDefaultDates); // Set default dates when page loads
document.getElementById('fetchButton').addEventListener('click', fetchAndDownload);
