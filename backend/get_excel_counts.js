const XLSX = require('xlsx');

function getCount(path) {
    try {
        const workbook = XLSX.readFile(path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);
        return data.length;
    } catch (e) {
        return `Error: ${e.message}`;
    }
}

console.log('PORTAL EXCEL COUNT:', getCount('d:\\cloud_backup\\abscloud\\Tally_Expiry_Report_All_2026-03-14.xlsx'));
console.log('ABS SERVICE EXCEL COUNT:', getCount('d:\\cloud_backup\\abscloud\\ABS Service.xlsx'));
