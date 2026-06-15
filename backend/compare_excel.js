const XLSX = require('xlsx');

function inspectExcel(path) {
    console.log(`\n--- Inspecting: ${path} ---`);
    try {
        const workbook = XLSX.readFile(path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        console.log(`Total Rows: ${data.length}`);
        if (data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
            console.log('First Row Sample:', JSON.stringify(data[0], null, 2));
            
            // Try to filter for March 2026 if columns exist
            const marchData = data.filter(row => {
                const dateVal = row['Expiry Date'] || row['ExpiryDate'] || row['Date'] || row['activity_date'];
                if (!dateVal) return false;
                const dateStr = String(dateVal);
                return dateStr.includes('03-2026') || dateStr.includes('/03/2026') || dateStr.includes('2026-03');
            });
            console.log(`Rows in March 2026: ${marchData.length}`);
        }
    } catch (e) {
        console.error(`Error reading ${path}:`, e.message);
    }
}

inspectExcel('d:\\cloud_backup\\abscloud\\Tally_Expiry_Report_All_2026-03-14.xlsx');
inspectExcel('d:\\cloud_backup\\abscloud\\ABS Service.xlsx');
