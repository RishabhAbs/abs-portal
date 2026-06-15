const XLSX = require('xlsx');

function inspectEnhanced(path, label) {
    console.log(`\n========================================`);
    console.log(`LABEL: ${label}`);
    console.log(`PATH: ${path}`);
    try {
        const workbook = XLSX.readFile(path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Read with header: 1 to get raw rows
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        console.log(`Total Physical Rows: ${rawData.length}`);
        
        if (rawData.length > 0) {
            console.log('Row 1 (Headers):', rawData[0]);
            if (rawData.length > 1) {
                console.log('Row 2 (First Data):', rawData[1]);
            }
        }
        
        // Convert to objects for easier analysis
        const data = XLSX.utils.sheet_to_json(worksheet);
        console.log(`Total Data Records (estimated): ${data.length}`);

    } catch (e) {
        console.error(`Error:`, e.message);
    }
}

inspectEnhanced('d:\\cloud_backup\\abscloud\\Tally_Expiry_Report_All_2026-03-14.xlsx', 'PORTAL_GENERATED');
inspectEnhanced('d:\\cloud_backup\\abscloud\\ABS Service.xlsx', 'REFERENCE_SOURCE');
